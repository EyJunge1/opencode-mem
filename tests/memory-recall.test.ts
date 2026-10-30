import { describe, expect, it } from "bun:test";
import {
  applyProjectBoost,
  filterRecallResults,
  mergeBoth,
  resolveRecallScope,
  shouldRefreshRecallOnPrompt,
  type RecallMemory,
} from "../src/services/memory-recall.js";
import { normalizeChatMessageRecall, normalizeChatMessageRecallScope } from "../src/config.js";

function mem(partial: Partial<RecallMemory> & { id: string }): RecallMemory {
  return {
    memory: partial.memory ?? `content-${partial.id}`,
    similarity: partial.similarity ?? 0.8,
    ...partial,
  };
}

describe("memory-recall helpers", () => {
  it("refreshes every turn for relevant/both even when injectOn is first", () => {
    expect(shouldRefreshRecallOnPrompt("relevant", "first")).toBe(true);
    expect(shouldRefreshRecallOnPrompt("both", "first")).toBe(true);
    expect(shouldRefreshRecallOnPrompt("recent", "first")).toBe(false);
    expect(shouldRefreshRecallOnPrompt("recent", "always")).toBe(true);
  });

  it("resolves recallScope default from memory.defaultScope", () => {
    expect(resolveRecallScope("default", "project")).toBe("project");
    expect(resolveRecallScope("default", "all-projects")).toBe("all-projects");
    expect(resolveRecallScope("project", "all-projects")).toBe("project");
    expect(resolveRecallScope("all-projects", "project")).toBe("all-projects");
  });

  it("normalizes recall config with safe fallbacks", () => {
    expect(normalizeChatMessageRecall("both")).toBe("both");
    expect(normalizeChatMessageRecall("nope")).toBe("relevant");
    expect(normalizeChatMessageRecallScope("all-projects")).toBe("all-projects");
    expect(normalizeChatMessageRecallScope(42)).toBe("default");
  });

  it("boosts current-project hits then re-sorts", () => {
    const tag = "opencode_project_abc";
    const boosted = applyProjectBoost(
      [
        mem({ id: "other", similarity: 0.9, containerTag: "opencode_project_other" }),
        mem({ id: "cur", similarity: 0.88, containerTag: tag }),
      ],
      tag
    );
    expect(boosted[0]!.id).toBe("cur");
    expect(boosted[0]!.similarity).toBeCloseTo(0.93);
    expect(boosted[1]!.similarity).toBe(0.9);
  });

  it("filters by session and age", () => {
    const now = Date.now();
    const filtered = filterRecallResults(
      [
        mem({ id: "a", sessionId: "sess-1", createdAt: now }),
        mem({ id: "b", metadata: { sessionID: "sess-2" }, createdAt: now }),
        mem({ id: "c", createdAt: now - 10 * 86400000 }),
      ],
      { excludeSessionId: "sess-1", createdAfter: now - 5 * 86400000 }
    );
    expect(filtered.map((m) => m.id)).toEqual(["b"]);
  });

  it("merges both: relevant first then recent with id dedupe", () => {
    const merged = mergeBoth(
      [mem({ id: "r1", similarity: 0.9 }), mem({ id: "shared", similarity: 0.85 })],
      [mem({ id: "shared", similarity: 1 }), mem({ id: "n1", similarity: 1 }), mem({ id: "n2" })],
      3
    );
    expect(merged.map((m) => m.id)).toEqual(["r1", "shared", "n1"]);
    expect(merged[1]!.similarity).toBe(0.85);
  });
});
