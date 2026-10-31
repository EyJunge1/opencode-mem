import { describe, expect, it } from "bun:test";
import {
  normalizeSimilarityUnitInterval,
  normalizeUpdateOnCaptureMaxCandidates,
} from "../src/config.js";
import {
  applyUpdateOnCaptureDecision,
  filterUpdateOnCaptureCandidates,
  type UpdateOnCaptureMemoryClient,
} from "../src/services/update-on-capture.js";

describe("update-on-capture config helpers", () => {
  it("clamps similarity thresholds to [0,1]", () => {
    expect(normalizeSimilarityUnitInterval(0.75, 0.5)).toBe(0.75);
    expect(normalizeSimilarityUnitInterval(-1, 0.5)).toBe(0);
    expect(normalizeSimilarityUnitInterval(2, 0.5)).toBe(1);
    expect(normalizeSimilarityUnitInterval("x", 0.5)).toBe(0.5);
  });

  it("normalizes max candidates", () => {
    expect(normalizeUpdateOnCaptureMaxCandidates(3)).toBe(3);
    expect(normalizeUpdateOnCaptureMaxCandidates(0)).toBe(5);
    expect(normalizeUpdateOnCaptureMaxCandidates(99)).toBe(20);
  });
});

describe("filterUpdateOnCaptureCandidates", () => {
  it("drops pinned and respects max", () => {
    const out = filterUpdateOnCaptureCandidates(
      [
        { id: "a", content: "a", similarity: 0.9, isPinned: true },
        { id: "b", content: "b", similarity: 0.8 },
        { id: "c", content: "c", similarity: 0.85 },
        { id: "d", content: "d", similarity: 0.7 },
      ],
      2
    );
    expect(out.map((c) => c.id)).toEqual(["c", "b"]);
  });
});

describe("applyUpdateOnCaptureDecision", () => {
  const baseInput = {
    summary: "KyuShared is on sda5",
    type: "configuration",
    tags: ["linux"],
    containerTag: "project_abc",
    metadata: {
      source: "auto-capture" as const,
      type: "configuration",
      tags: ["linux"],
      sessionID: "s1",
      promptId: "p1",
      captureTimestamp: 1,
    },
  };

  function mockClient(
    overrides: Partial<UpdateOnCaptureMemoryClient> = {}
  ): UpdateOnCaptureMemoryClient & {
    calls: string[];
  } {
    const calls: string[] = [];
    return {
      calls,
      addMemory: async () => {
        calls.push("add");
        return { success: true, id: "mem_new" };
      },
      updateMemory: async (id) => {
        calls.push(`update:${id}`);
        return { success: true };
      },
      deleteMemory: async (id, patch) => {
        calls.push(`delete:${id}:${JSON.stringify(patch)}`);
        return { success: true };
      },
      getMemoryById: async (id) => {
        calls.push(`get:${id}`);
        return { success: true, memory: { id, content: "old", isPinned: false } };
      },
      ...overrides,
    };
  }

  it("adds when action is add", async () => {
    const client = mockClient();
    const result = await applyUpdateOnCaptureDecision(
      client,
      { action: "add" },
      baseInput,
      new Set(["mem_old"])
    );
    expect(result).toEqual({ success: true, id: "mem_new", action: "add" });
    expect(client.calls).toEqual(["add"]);
  });

  it("updates a valid candidate", async () => {
    const client = mockClient();
    const result = await applyUpdateOnCaptureDecision(
      client,
      { action: "update", targetId: "mem_old", content: "rewritten" },
      baseInput,
      new Set(["mem_old"])
    );
    expect(result.action).toBe("update");
    expect(result.id).toBe("mem_old");
    expect(client.calls[0]).toBe("get:mem_old");
    expect(client.calls[1]).toBe("update:mem_old");
  });

  it("supersedes by adding then soft-deleting", async () => {
    const client = mockClient();
    const result = await applyUpdateOnCaptureDecision(
      client,
      { action: "supersede", targetId: "mem_old" },
      baseInput,
      new Set(["mem_old"])
    );
    expect(result).toEqual({ success: true, id: "mem_new", action: "supersede" });
    expect(client.calls).toContain("add");
    expect(client.calls.some((c) => c.startsWith("delete:mem_old:"))).toBe(true);
  });

  it("falls back to add for invalid target", async () => {
    const client = mockClient();
    const result = await applyUpdateOnCaptureDecision(
      client,
      { action: "update", targetId: "missing" },
      baseInput,
      new Set(["mem_old"])
    );
    expect(result.action).toBe("add");
    expect(client.calls).toEqual(["add"]);
  });

  it("falls back to add when target is pinned", async () => {
    const client = mockClient({
      getMemoryById: async (id) => ({
        success: true,
        memory: { id, content: "old", isPinned: true },
      }),
    });
    const result = await applyUpdateOnCaptureDecision(
      client,
      { action: "update", targetId: "mem_old", content: "x" },
      baseInput,
      new Set(["mem_old"])
    );
    expect(result.action).toBe("add");
  });
});
