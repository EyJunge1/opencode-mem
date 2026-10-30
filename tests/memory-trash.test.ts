import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tryAcquireDreamingLock } from "../src/services/dreaming-lock.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

describe("dreaming lock", () => {
  let baseDir: string | undefined;
  let previousStorage: string | undefined;

  afterEach(async () => {
    if (previousStorage !== undefined) {
      const { CONFIG } = await import("../src/config.js");
      CONFIG.storagePath = previousStorage;
    }
    if (baseDir) await cleanupTursoTestDirectory(baseDir);
    baseDir = undefined;
  });

  it("allows only one holder at a time and releases cleanly", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "dream-lock-"));
    const { CONFIG } = await import("../src/config.js");
    previousStorage = CONFIG.storagePath;
    CONFIG.storagePath = baseDir;

    const first = tryAcquireDreamingLock();
    expect(first).not.toBeNull();
    const second = tryAcquireDreamingLock();
    expect(second).toBeNull();
    first!();
    const third = tryAcquireDreamingLock();
    expect(third).not.toBeNull();
    third!();
  });
});

describe("memory soft-delete trash", () => {
  let baseDir: string;
  let restoreEmbedding: (() => void) | undefined;
  let previousBackend: "database" | "markdown" | undefined;
  let previousStorage: string | undefined;
  let previousDims: number | undefined;

  afterEach(async () => {
    restoreEmbedding?.();
    restoreEmbedding = undefined;
    const { CONFIG } = await import("../src/config.js");
    if (previousBackend !== undefined) CONFIG.memoryBackend = previousBackend;
    if (previousStorage !== undefined) CONFIG.storagePath = previousStorage;
    if (previousDims !== undefined) CONFIG.embeddingDimensions = previousDims;
    previousBackend = undefined;
    previousStorage = undefined;
    previousDims = undefined;
    const { memoryClient } = await import("../src/services/client.js");
    memoryClient.reset();
    const { resetTursoReady } = await import("../src/services/turso/ready.js");
    resetTursoReady();
    if (baseDir) await cleanupTursoTestDirectory(baseDir);
  });

  async function stubEmbedding() {
    const { embeddingService } = await import("../src/services/embedding.js");
    const service = embeddingService as any;
    const original = {
      warmup: service.warmup,
      clearCache: service.clearCache,
      embedWithTimeout: service.embedWithTimeout,
      isWarmedUp: service.isWarmedUp,
    };
    service.warmup = async () => {
      service.isWarmedUp = true;
    };
    service.clearCache = () => {};
    service.embedWithTimeout = async () => new Float32Array([1, 0]);
    restoreEmbedding = () => Object.assign(service, original);
  }

  it("hides soft-deleted rows from list and restores them from trash", async () => {
    baseDir = mkdtempSync(join(tmpdir(), "mem-trash-"));
    const storage = join(baseDir, "storage");

    const { CONFIG } = await import("../src/config.js");
    previousBackend = CONFIG.memoryBackend;
    previousStorage = CONFIG.storagePath;
    previousDims = CONFIG.embeddingDimensions;
    CONFIG.storagePath = storage;
    CONFIG.embeddingDimensions = 2;
    CONFIG.memoryBackend = "database";

    await stubEmbedding();

    const { memoryClient } = await import("../src/services/client.js");
    memoryClient.reset();

    const { getProjectTagInfo } = await import("../src/services/tags.js");
    const tag = getProjectTagInfo(baseDir);

    const added = await memoryClient.addMemory("trashable memory", tag.tag, {
      source: "manual",
      type: "fact",
    });
    expect(added.success).toBe(true);
    if (!added.success) {
      throw new Error(added.error || "addMemory failed");
    }

    const before = await memoryClient.listMemories(tag.tag, 10, "project");
    expect(before.memories.some((m: { id: string }) => m.id === added.id)).toBe(true);

    const deleted = await memoryClient.deleteMemory(added.id);
    expect(deleted.success).toBe(true);

    const after = await memoryClient.listMemories(tag.tag, 10, "project");
    expect(after.memories.some((m: { id: string }) => m.id === added.id)).toBe(false);

    const { handleListTrash, handleRestoreMemory } =
      await import("../src/services/api-handlers.js");
    const trash = await handleListTrash();
    expect(trash.success).toBe(true);
    expect(trash.data?.some((row) => row.id === added.id)).toBe(true);

    const restored = await handleRestoreMemory(added.id);
    expect(restored.success).toBe(true);

    const again = await memoryClient.listMemories(tag.tag, 10, "project");
    expect(again.memories.some((m: { id: string }) => m.id === added.id)).toBe(true);
  });
});
