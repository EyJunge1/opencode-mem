import { CONFIG, isConfigured } from "../config.js";
import type { MemoryType } from "../types/index.js";
import { memoryClient, type MemoryScope } from "./client.js";
import { getLanguageName } from "./language-detector.js";
import { stripPrivateContent, isFullyPrivate } from "./privacy.js";
import { getTags } from "./tags.js";
import { platformSourceFromMetadata, resolvePlatformSource } from "./platform-source.js";
import { getSharedRuntimeBridge } from "./shared-runtime-bridge.js";

export type MemoryToolMode =
  | "add"
  | "search"
  | "profile"
  | "list"
  | "forget"
  | "help"
  | "migrate"
  | "list-shards"
  | "export"
  | "import";

export interface MemoryToolArgs {
  mode?: MemoryToolMode;
  content?: string;
  query?: string;
  tags?: string;
  type?: MemoryType;
  memoryId?: string;
  limit?: number;
  scope?: MemoryScope;
  fromPath?: string;
  fromHash?: string;
  outputPath?: string;
  inputPath?: string;
  dryRun?: boolean;
  allowLinkedSource?: boolean;
}

export interface MemoryToolContext {
  directory: string;
  /** Provenance stamp written into memory metadata on add. */
  platformSource?: string;
}

/** Default compact search limit for MCP progressive disclosure. */
export const MCP_SEARCH_DEFAULT_LIMIT = 5;
/** Default chronological timeline limit for MCP progressive disclosure. */
export const MCP_TIMELINE_DEFAULT_LIMIT = 10;
/** Max characters kept in an MCP search snippet. */
export const MCP_SNIPPET_MAX_CHARS = 160;

export function formatSearchResults(query: string, results: any, limit?: number): string {
  const memoryResults = results.results || [];
  return JSON.stringify({
    success: true,
    query,
    count: memoryResults.length,
    results: memoryResults.slice(0, limit || 10).map((r: any) => {
      const platformSource = platformSourceFromMetadata(r.metadata);
      return {
        id: r.id,
        content: r.memory || r.chunk,
        similarity: Math.round(r.similarity * 100),
        ...(platformSource ? { platformSource } : {}),
      };
    }),
  });
}

function snippetFromContent(content: string, maxChars = MCP_SNIPPET_MAX_CHARS): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * Shared memory tool implementation used by the OpenCode plugin, standalone
 * HTTP MCP endpoints, and (indirectly) the MCP stdio server.
 *
 * When a shared runtime bridge is active (OpenCode attached to `serve`), common
 * modes are proxied over HTTP so Turso/embeddings stay single-owner.
 */
export async function executeMemoryTool(
  args: MemoryToolArgs,
  ctx: MemoryToolContext
): Promise<string> {
  if (!isConfigured()) {
    return JSON.stringify({
      success: false,
      error: "Memory system not configured properly.",
    });
  }

  const mode = args.mode || "help";
  const bridge = getSharedRuntimeBridge();
  if (bridge && ["add", "search", "list", "forget", "profile"].includes(mode)) {
    return executeMemoryToolViaBridge(args, ctx, bridge);
  }

  return executeMemoryToolLocal(args, ctx);
}

async function executeMemoryToolViaBridge(
  args: MemoryToolArgs,
  ctx: MemoryToolContext,
  bridge: NonNullable<ReturnType<typeof getSharedRuntimeBridge>>
): Promise<string> {
  const mode = args.mode || "help";
  const platformSource = resolvePlatformSource(ctx.platformSource);

  try {
    switch (mode) {
      case "help":
        return executeMemoryToolLocal({ mode: "help" }, ctx);
      case "search": {
        if (!args.query) return JSON.stringify({ success: false, error: "query required" });
        const result = await bridge.search({
          query: args.query,
          limit: args.limit,
          scope: args.scope,
        });
        return JSON.stringify(result);
      }
      case "list": {
        const result = await bridge.timeline({
          limit: args.limit,
          scope: args.scope,
        });
        return JSON.stringify(result);
      }
      case "add": {
        const result = await bridge.write({
          action: "add",
          content: args.content,
          tags: args.tags,
          type: args.type,
          platformSource,
        });
        return JSON.stringify(result);
      }
      case "forget": {
        const result = await bridge.write({
          action: "forget",
          memoryId: args.memoryId,
          platformSource,
        });
        return JSON.stringify(result);
      }
      case "profile": {
        const result = await bridge.write({
          action: "profile",
          content: args.content,
          platformSource,
        });
        return JSON.stringify(result);
      }
      default:
        return executeMemoryToolLocal(args, ctx);
    }
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Shared runtime request failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function executeMemoryToolLocal(
  args: MemoryToolArgs,
  ctx: MemoryToolContext
): Promise<string> {
  const { directory } = ctx;
  const platformSource = resolvePlatformSource(ctx.platformSource);
  const tags = getTags(directory);
  const mode = args.mode || "help";
  const needsEmbedding = !["help", "list-shards", "migrate", "export"].includes(mode);

  if (needsEmbedding) {
    const embeddingInitError = memoryClient.getEmbeddingInitError?.();
    if (embeddingInitError) {
      return JSON.stringify({ success: false, error: embeddingInitError });
    }
  }

  try {
    if (needsEmbedding) {
      await memoryClient.warmup();
    } else if (mode !== "help") {
      await memoryClient.ensureStorageReady();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({
      success: false,
      error: `Memory system failed to initialize: ${message}`,
    });
  }

  const langName = getLanguageName(CONFIG.autoCaptureLanguage || "en");

  try {
    switch (mode) {
      case "help":
        return JSON.stringify({
          success: true,
          message: "Memory System Usage Guide",
          commands: [
            {
              command: "add",
              description: `Store new memory (MATCH USER LANGUAGE: ${langName})`,
              args: ["content", "type?", "tags?"],
            },
            {
              command: "search",
              description: `Search memories via keywords (MATCH USER LANGUAGE: ${langName})`,
              args: ["query"],
            },
            {
              command: "profile",
              description:
                "View user profile or save an explicit preference (provide content to write)",
              args: ["content?"],
            },
            { command: "list", description: "List recent memories", args: ["limit?"] },
            { command: "forget", description: "Remove memory", args: ["memoryId"] },
            {
              command: "list-shards",
              description: "List project memory shards and orphaned path associations",
              args: [],
            },
            {
              command: "migrate",
              description:
                "Reassociate orphaned project shards after a directory move (target must be empty)",
              args: ["fromPath?", "fromHash?", "dryRun?", "allowLinkedSource?"],
            },
            {
              command: "export",
              description: "Export current project memories to a portable JSON file",
              args: ["outputPath"],
            },
            {
              command: "import",
              description:
                "Import memories from a portable JSON file (re-embeds; aborts on duplicate ids)",
              args: ["inputPath", "dryRun?"],
            },
          ],
          tagGuidance: "Use technical keywords for search. Tags rank highest.",
          platformSource,
        });

      case "add": {
        if (!args.content) return JSON.stringify({ success: false, error: "content required" });
        const sanitizedContent = stripPrivateContent(args.content);
        if (isFullyPrivate(args.content))
          return JSON.stringify({ success: false, error: "Private content blocked" });
        const tagInfo = tags.project;
        const parsedTags = args.tags
          ? args.tags.split(",").map((t) => t.trim().toLowerCase())
          : undefined;
        const result = await memoryClient.addMemory(sanitizedContent, tagInfo.tag, {
          type: args.type,
          tags: parsedTags,
          source: "manual",
          platformSource,
          displayName: tagInfo.displayName,
          userName: tagInfo.userName,
          userEmail: tagInfo.userEmail,
          projectPath: tagInfo.projectPath,
          projectName: tagInfo.projectName,
          gitRepoUrl: tagInfo.gitRepoUrl,
        });
        return JSON.stringify({
          success: result.success,
          message: result.success ? `Memory added` : result.error,
          id: result.success ? result.id : undefined,
          tags: parsedTags,
          platformSource,
        });
      }

      case "search": {
        if (!args.query) return JSON.stringify({ success: false, error: "query required" });
        const searchRes = await memoryClient.searchMemories(
          args.query,
          tags.project.tag,
          args.scope ?? CONFIG.memory.defaultScope
        );
        if (!searchRes.success) return JSON.stringify({ success: false, error: searchRes.error });
        return formatSearchResults(args.query, searchRes, args.limit);
      }

      case "profile": {
        if (args.query) {
          return JSON.stringify({
            success: false,
            error:
              "query is not valid for profile mode. Use content to write a preference or omit all args to read.",
          });
        }

        const { userProfileManager } = await import("./user-profile/user-profile-manager.js");
        const { toPublicProfileData } = await import("./user-profile/profile-utils.js");
        const { tryAcquireProfileLearningLock } = await import("./user-profile/learning-lock.js");

        const userId = tags.user.userEmail || "unknown";

        if (args.content !== undefined) {
          const trimmed = args.content.trim();
          if (!trimmed) {
            return JSON.stringify({ success: false, error: "content must not be blank" });
          }

          if (!tags.user.userEmail) {
            return JSON.stringify({
              success: false,
              error:
                "Cannot save profile preference because no user email could be resolved. Configure userEmailOverride or git user.email.",
            });
          }

          const sanitizedContent = stripPrivateContent(trimmed);
          const hasNonPrivateContent =
            sanitizedContent.replace(/\[REDACTED\]/g, "").trim().length > 0;

          if (isFullyPrivate(trimmed) || !hasNonPrivateContent) {
            return JSON.stringify({ success: false, error: "Private content blocked" });
          }

          const releaseProfileWriteLock = await tryAcquireProfileLearningLock(directory);
          if (!releaseProfileWriteLock) {
            return JSON.stringify({
              success: false,
              error:
                "Profile preference save is temporarily unavailable because profile learning holds the lock. Retry shortly.",
            });
          }

          try {
            const newPreference = {
              category: "explicit",
              description: sanitizedContent,
              confidence: 1.0,
              frequency: 1,
              evidence: ["manual-write"],
              lastSeen: Date.now(),
            };

            const existingProfile = await userProfileManager.getActiveProfile(userId);

            if (existingProfile) {
              const existingData = JSON.parse(existingProfile.profileData);
              const mergedData = await userProfileManager.mergeProfileData(
                existingData,
                {
                  preferences: [newPreference],
                },
                undefined,
                existingProfile.id
              );
              await userProfileManager.updateProfile(
                existingProfile.id,
                mergedData,
                0,
                `Explicit preference added: ${sanitizedContent.slice(0, 80)}`
              );
              return JSON.stringify({
                success: true,
                message: "Preference saved to profile",
              });
            }

            await userProfileManager.createProfile(
              userId,
              tags.user.displayName || userId,
              tags.user.userName || userId,
              tags.user.userEmail || userId,
              { preferences: [newPreference], patterns: [], workflows: [] },
              0
            );
            return JSON.stringify({
              success: true,
              message: "Profile created with preference",
            });
          } finally {
            await releaseProfileWriteLock();
          }
        }

        const profile = await userProfileManager.getActiveProfile(userId);
        if (!profile) return JSON.stringify({ success: true, profile: null });
        const pData = toPublicProfileData(JSON.parse(profile.profileData));
        return JSON.stringify({
          success: true,
          profile: {
            ...pData,
            version: profile.version,
            lastAnalyzed: profile.lastAnalyzedAt,
          },
        });
      }

      case "list": {
        const listRes = await memoryClient.listMemories(
          tags.project.tag,
          args.limit || 20,
          args.scope ?? CONFIG.memory.defaultScope
        );
        if (!listRes.success) return JSON.stringify({ success: false, error: listRes.error });
        return JSON.stringify({
          success: true,
          count: listRes.memories?.length,
          memories: listRes.memories?.map((m: any) => ({
            id: m.id,
            content: m.summary,
            createdAt: m.createdAt,
          })),
        });
      }

      case "forget": {
        if (!args.memoryId) return JSON.stringify({ success: false, error: "memoryId required" });
        const delRes = await memoryClient.deleteMemory(args.memoryId);
        return JSON.stringify({ success: delRes.success, message: `Memory removed` });
      }

      case "list-shards": {
        const listShardsRes = await memoryClient.listShards(directory);
        return JSON.stringify(listShardsRes);
      }

      case "migrate": {
        if (!args.fromPath && !args.fromHash) {
          return JSON.stringify({
            success: false,
            error:
              "fromPath or fromHash required. Run memory list-shards to discover orphaned shards.",
          });
        }
        const migrateRes = await memoryClient.migrateProjectPath({
          currentDirectory: directory,
          fromPath: args.fromPath,
          fromHash: args.fromHash,
          dryRun: args.dryRun,
          allowLinkedSource: args.allowLinkedSource,
        });
        return JSON.stringify(migrateRes);
      }

      case "export": {
        if (!args.outputPath) {
          return JSON.stringify({ success: false, error: "outputPath required" });
        }
        const exportRes = await memoryClient.exportMemories(directory, args.outputPath);
        return JSON.stringify(exportRes);
      }

      case "import": {
        if (!args.inputPath) {
          return JSON.stringify({ success: false, error: "inputPath required" });
        }
        const importRes = await memoryClient.importMemories(directory, args.inputPath, args.dryRun);
        return JSON.stringify(importRes);
      }

      default:
        return JSON.stringify({ success: false, error: `Unknown mode: ${mode}` });
    }
  } catch (error) {
    return JSON.stringify({ success: false, error: String(error) });
  }
}

/** Compact index search for MCP progressive disclosure. */
export async function mcpSearchMemories(
  args: {
    query: string;
    limit?: number;
    scope?: MemoryScope;
  },
  ctx: MemoryToolContext
): Promise<object> {
  if (!args.query?.trim()) {
    return { success: false, error: "query required" };
  }

  const limit = Math.min(Math.max(args.limit ?? MCP_SEARCH_DEFAULT_LIMIT, 1), 20);
  const raw = await executeMemoryTool(
    {
      mode: "search",
      query: args.query,
      limit,
      scope: args.scope,
    },
    ctx
  );
  const parsed = JSON.parse(raw) as {
    success: boolean;
    error?: string;
    query?: string;
    count?: number;
    results?: Array<{
      id?: string;
      content?: string;
      similarity?: number;
      platformSource?: string;
    }>;
  };

  if (!parsed.success) {
    return { success: false, error: parsed.error ?? "search failed" };
  }

  return {
    success: true,
    query: parsed.query,
    count: parsed.results?.length ?? 0,
    results: (parsed.results ?? []).map((r) => ({
      id: r.id,
      score: r.similarity,
      snippet: snippetFromContent(String(r.content ?? "")),
      ...(r.platformSource ? { platformSource: r.platformSource } : {}),
    })),
    hint: "Call memory_get with promising ids to fetch full content.",
  };
}

/**
 * Chronological compact index for MCP progressive disclosure.
 * Use at session start (or after search) before memory_get.
 */
export async function mcpTimelineMemories(
  args: {
    limit?: number;
    scope?: MemoryScope;
  },
  ctx: MemoryToolContext
): Promise<object> {
  const limit = Math.min(Math.max(args.limit ?? MCP_TIMELINE_DEFAULT_LIMIT, 1), 20);
  const raw = await executeMemoryTool(
    {
      mode: "list",
      limit,
      scope: args.scope,
    },
    ctx
  );
  const parsed = JSON.parse(raw) as {
    success: boolean;
    error?: string;
    count?: number;
    memories?: Array<{
      id?: string;
      content?: string;
      createdAt?: string;
    }>;
  };

  if (!parsed.success) {
    return { success: false, error: parsed.error ?? "timeline failed" };
  }

  return {
    success: true,
    count: parsed.memories?.length ?? 0,
    memories: (parsed.memories ?? []).map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      snippet: snippetFromContent(String(m.content ?? "")),
    })),
    hint: "Call memory_get with promising ids to fetch full content. Use memory_search for topical queries.",
  };
}

/** Fetch full memories by id for MCP progressive disclosure. */
export async function mcpGetMemories(ids: string[]): Promise<object> {
  if (!isConfigured()) {
    return { success: false, error: "Memory system not configured properly." };
  }

  try {
    await memoryClient.ensureStorageReady();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Memory system failed to initialize: ${message}` };
  }

  const result = await memoryClient.getMemoriesByIds(ids);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, count: result.memories.length, memories: result.memories };
}

/** Mutating MCP write surface: add | forget | profile. */
export async function mcpWriteMemory(
  args: {
    action: "add" | "forget" | "profile";
    content?: string;
    tags?: string;
    type?: MemoryType;
    memoryId?: string;
  },
  ctx: MemoryToolContext
): Promise<object> {
  const toolCtx: MemoryToolContext = {
    directory: ctx.directory,
    platformSource: resolvePlatformSource(ctx.platformSource ?? "mcp"),
  };
  if (args.action === "add") {
    return JSON.parse(
      await executeMemoryTool(
        { mode: "add", content: args.content, tags: args.tags, type: args.type },
        toolCtx
      )
    );
  }
  if (args.action === "forget") {
    return JSON.parse(
      await executeMemoryTool({ mode: "forget", memoryId: args.memoryId }, toolCtx)
    );
  }
  if (args.action === "profile") {
    return JSON.parse(await executeMemoryTool({ mode: "profile", content: args.content }, toolCtx));
  }
  return { success: false, error: `Unknown action: ${args.action}` };
}
