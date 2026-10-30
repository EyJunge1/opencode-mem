import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CONFIG } from "../config.js";
import { embeddingService } from "./embedding.js";
import { log } from "./logger.js";
import { cosineSimilarity } from "../utils/math.js";
import { ensureTursoReady } from "./turso/ready.js";
import { tursoConnectionManager } from "./turso/connection-manager.js";
import { tursoShardManager } from "./turso/shard-manager.js";
import { tursoVectorSearch } from "./turso/vector-search.js";
import { parseExtractedVector, formatTagsForEmbedding } from "./turso/vector-utils.js";
import { getV2Client } from "./ai/opencode-provider.js";
import { tryAcquireDreamingLock } from "./dreaming-lock.js";

export interface DreamingNearDupGroup {
  representative: {
    id: string;
    content: string;
    containerTag: string;
    createdAt: number;
    isPinned: boolean;
  };
  duplicates: Array<{
    id: string;
    content: string;
    similarity: number;
    isPinned: boolean;
  }>;
}

export interface DreamingRunResult {
  groupsConsidered: number;
  groupsMerged: number;
  groupsSkipped: number;
  memoriesSoftDeleted: number;
}

interface DreamingState {
  lastRunAt: number;
}

const mergeSchema = z.object({
  action: z.enum(["merge", "skip"]),
  content: z.string().optional(),
  keepId: z.string().optional(),
  dropIds: z.array(z.string()).optional(),
  reason: z.string().optional(),
});

function statePath(): string {
  return join(CONFIG.storagePath, "dreaming-state.json");
}

function readState(): DreamingState {
  try {
    const path = statePath();
    if (!existsSync(path)) return { lastRunAt: 0 };
    const raw = JSON.parse(readFileSync(path, "utf-8")) as DreamingState;
    return { lastRunAt: Number(raw.lastRunAt) || 0 };
  } catch {
    return { lastRunAt: 0 };
  }
}

function writeState(state: DreamingState): void {
  const dir = CONFIG.storagePath;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state), "utf-8");
}

export async function findNearDuplicateGroupsForDreaming(): Promise<DreamingNearDupGroup[]> {
  await ensureTursoReady();
  const userShards = await tursoShardManager.getAllShards("user", "");
  const projectShards = await tursoShardManager.getAllShards("project", "");
  const allShards = [...userShards, ...projectShards];
  const groups: DreamingNearDupGroup[] = [];
  const threshold = CONFIG.deduplicationSimilarityThreshold;

  for (const shard of allShards) {
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    const memories = await tursoVectorSearch.getAllMemoriesWithExtractedVectors(db);
    const processedIds = new Set<string>();

    for (let i = 0; i < memories.length; i++) {
      const mem1 = memories[i]!;
      if (Number(mem1.is_pinned ?? 0) === 1) continue;
      const vector1 = parseExtractedVector(mem1.vector_json);
      if (!vector1 || processedIds.has(String(mem1.id))) continue;

      const similarGroup: DreamingNearDupGroup = {
        representative: {
          id: String(mem1.id),
          content: String(mem1.content),
          containerTag: String(mem1.container_tag),
          createdAt: Number(mem1.created_at),
          isPinned: false,
        },
        duplicates: [],
      };

      for (let j = i + 1; j < memories.length; j++) {
        const mem2 = memories[j]!;
        if (Number(mem2.is_pinned ?? 0) === 1) continue;
        const vector2 = parseExtractedVector(mem2.vector_json);
        if (!vector2 || processedIds.has(String(mem2.id))) continue;
        if (mem1.container_tag !== mem2.container_tag) continue;

        const similarity = cosineSimilarity(vector1, vector2);
        if (similarity >= threshold && similarity < 1.0) {
          similarGroup.duplicates.push({
            id: String(mem2.id),
            content: String(mem2.content),
            similarity,
            isPinned: false,
          });
          processedIds.add(String(mem2.id));
        }
      }

      if (similarGroup.duplicates.length > 0) {
        processedIds.add(String(mem1.id));
        groups.push(similarGroup);
      }
    }
  }

  return groups;
}

function buildMergePrompt(group: DreamingNearDupGroup): string {
  const items = [
    { id: group.representative.id, content: group.representative.content },
    ...group.duplicates.map((d) => ({ id: d.id, content: d.content })),
  ];
  return `You consolidate near-duplicate project memories into one clearer entry.

Rules:
- Prefer action "merge" only when the memories clearly describe the same fact/fix/gotcha.
- The merged content MUST retain important details, including why something failed when present.
- Do NOT invent facts. Do NOT drop unique constraints, commands, paths, or error messages.
- keepId must be one of the input ids (prefer the most complete/recent).
- dropIds must list every other id when merging.
- Use action "skip" when memories are related but not safe to merge.

Return JSON matching the schema.

Memories:
${JSON.stringify(items, null, 2)}`;
}

export class DreamingService {
  private isRunning = false;

  getStatus() {
    const state = readState();
    return {
      enabled: CONFIG.dreaming.enabled,
      intervalHours: CONFIG.dreaming.intervalHours,
      maxGroupsPerRun: CONFIG.dreaming.maxGroupsPerRun,
      trashRetentionDays: CONFIG.dreaming.trashRetentionDays,
      isRunning: this.isRunning,
      lastRunAt: state.lastRunAt || null,
    };
  }

  async shouldRun(): Promise<boolean> {
    if (!CONFIG.dreaming.enabled) return false;
    if (this.isRunning) return false;
    if (!CONFIG.autoCaptureProviderStatus?.ready) return false;
    const state = readState();
    const intervalMs = CONFIG.dreaming.intervalHours * 60 * 60 * 1000;
    return Date.now() - state.lastRunAt >= intervalMs;
  }

  async maybeRun(directory?: string): Promise<DreamingRunResult | null> {
    if (!(await this.shouldRun())) return null;
    try {
      return await this.run(directory);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("another process") || message.includes("already running")) {
        log("dreaming: skipped due to lock contention", { error: message });
        return null;
      }
      throw error;
    }
  }

  /** Manual or gated run. Does not re-check interval; caller uses maybeRun for that. */
  async run(directory?: string): Promise<DreamingRunResult> {
    if (this.isRunning) {
      throw new Error("Dreaming already running");
    }
    const releaseLock = tryAcquireDreamingLock();
    if (!releaseLock) {
      throw new Error("Dreaming already running in another process");
    }
    this.isRunning = true;
    const result: DreamingRunResult = {
      groupsConsidered: 0,
      groupsMerged: 0,
      groupsSkipped: 0,
      memoriesSoftDeleted: 0,
    };

    try {
      await ensureTursoReady();
      const groups = await findNearDuplicateGroupsForDreaming();
      const batch = groups.slice(0, CONFIG.dreaming.maxGroupsPerRun);
      result.groupsConsidered = batch.length;

      if (batch.length === 0) {
        writeState({ lastRunAt: Date.now() });
        return result;
      }

      const v2Client = getV2Client();
      if (!v2Client || !CONFIG.opencodeProvider || !CONFIG.opencodeModel) {
        log("dreaming: skipped (no opencode structured-output client)");
        return result;
      }

      const { generateStructuredOutput } = await import("./ai/opencode-provider.js");

      for (const group of batch) {
        try {
          const decision = await generateStructuredOutput({
            client: v2Client,
            providerID: CONFIG.opencodeProvider,
            modelID: CONFIG.opencodeModel,
            ...(CONFIG.opencodeVariant ? { variant: CONFIG.opencodeVariant } : {}),
            systemPrompt:
              "You are a careful memory consolidation assistant. Return only structured JSON.",
            userPrompt: buildMergePrompt(group),
            schema: mergeSchema,
            directory,
          });

          if (decision.action !== "merge" || !decision.content?.trim()) {
            result.groupsSkipped++;
            continue;
          }

          const memberIds = new Set([
            group.representative.id,
            ...group.duplicates.map((d) => d.id),
          ]);
          const keepId =
            decision.keepId && memberIds.has(decision.keepId)
              ? decision.keepId
              : group.representative.id;
          const dropIds = (decision.dropIds || [])
            .filter((id) => memberIds.has(id) && id !== keepId)
            .filter((id, idx, arr) => arr.indexOf(id) === idx);
          const finalDrop =
            dropIds.length > 0 ? dropIds : [...memberIds].filter((id) => id !== keepId);

          if (finalDrop.length === 0) {
            result.groupsSkipped++;
            continue;
          }

          const applied = await this.applyMerge(
            keepId,
            decision.content.trim(),
            finalDrop,
            group.representative.containerTag
          );
          if (applied) {
            result.groupsMerged++;
            result.memoriesSoftDeleted += finalDrop.length;
          } else {
            result.groupsSkipped++;
          }
        } catch (error) {
          result.groupsSkipped++;
          log("dreaming: group failed", { error: String(error) });
        }
      }

      writeState({ lastRunAt: Date.now() });
      log("dreaming: run complete", result);
      return result;
    } finally {
      this.isRunning = false;
      releaseLock();
    }
  }

  private async applyMerge(
    keepId: string,
    content: string,
    dropIds: string[],
    containerTag: string
  ): Promise<boolean> {
    const shards = [
      ...(await tursoShardManager.getAllShards("user", "")),
      ...(await tursoShardManager.getAllShards("project", "")),
    ];

    let keepShard = null;
    let keepRow: Record<string, unknown> | null = null;
    for (const shard of shards) {
      const db = await tursoConnectionManager.getConnection(shard.dbPath);
      const row = await tursoVectorSearch.getMemoryById(db, keepId);
      if (row) {
        keepShard = shard;
        keepRow = row;
        break;
      }
    }
    if (!keepShard || !keepRow) return false;
    if (Number(keepRow.is_pinned ?? 0) === 1) return false;

    await embeddingService.warmup();
    const vector = await embeddingService.embedWithTimeout(content, { task: "document" });
    const existingTags = keepRow.tags ? String(keepRow.tags) : "";
    const tags = existingTags
      ? existingTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    let tagsVector: Float32Array | undefined;
    if (tags.length > 0) {
      tagsVector = await embeddingService.embedWithTimeout(formatTagsForEmbedding(tags), {
        task: "document",
      });
    }

    const meta =
      keepRow.metadata && typeof keepRow.metadata === "string"
        ? (JSON.parse(keepRow.metadata) as Record<string, unknown>)
        : {};
    const mergedFrom = Array.isArray(meta.mergedFrom) ? [...(meta.mergedFrom as string[])] : [];
    for (const id of dropIds) {
      if (!mergedFrom.includes(id)) mergedFrom.push(id);
    }
    meta.mergedFrom = mergedFrom;
    meta.source = typeof meta.source === "string" ? meta.source : "dreaming";

    const db = await tursoConnectionManager.getConnection(keepShard.dbPath);
    const updatedAt = Date.now();
    const isPinned = Number(keepRow.is_pinned ?? 0) === 1 ? 1 : 0;

    await db.transaction("write", async (tx) => {
      await tx.execute({ sql: `DELETE FROM memories WHERE id = ?`, args: [keepId] });
      await tx.execute({
        sql: `
          INSERT INTO memories (
            id, content, vector, tags_vector, container_tag, tags, type, created_at, updated_at,
            metadata, session_id, display_name, user_name, user_email, project_path, project_name, git_repo_url,
            is_pinned, deleted_at
          ) VALUES (?, ?, vector32(?), ${tagsVector ? "vector32(?)" : "NULL"}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `,
        args: [
          keepId,
          content,
          JSON.stringify(Array.from(vector)),
          ...(tagsVector ? [JSON.stringify(Array.from(tagsVector))] : []),
          containerTag || String(keepRow.container_tag),
          tags.length > 0 ? tags.join(",") : null,
          keepRow.type ? String(keepRow.type) : null,
          Number(keepRow.created_at),
          updatedAt,
          JSON.stringify(meta),
          keepRow.session_id ? String(keepRow.session_id) : null,
          keepRow.display_name ? String(keepRow.display_name) : null,
          keepRow.user_name ? String(keepRow.user_name) : null,
          keepRow.user_email ? String(keepRow.user_email) : null,
          keepRow.project_path ? String(keepRow.project_path) : null,
          keepRow.project_name ? String(keepRow.project_name) : null,
          keepRow.git_repo_url ? String(keepRow.git_repo_url) : null,
          isPinned,
        ],
      });
    });

    for (const dropId of dropIds) {
      for (const shard of shards) {
        const dropDb = await tursoConnectionManager.getConnection(shard.dbPath);
        const dropRow = await tursoVectorSearch.getMemoryById(dropDb, dropId);
        if (!dropRow) continue;
        if (Number(dropRow.is_pinned ?? 0) === 1) continue;
        await tursoVectorSearch.softDeleteVector(dropDb, dropId, { mergedInto: keepId });
        break;
      }
    }

    return true;
  }
}

export const dreamingService = new DreamingService();
