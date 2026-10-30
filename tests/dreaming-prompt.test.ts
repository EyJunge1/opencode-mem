import { describe, expect, it } from "bun:test";
import {
  normalizeDreamingIntervalHours,
  normalizeDreamingMaxGroupsPerRun,
  normalizeDreamingTrashRetentionDays,
} from "../src/config.js";
import { mergeBoth, applyProjectBoost } from "../src/services/memory-recall.js";

describe("dreaming config helpers", () => {
  it("normalizes dreaming numeric knobs", () => {
    expect(normalizeDreamingIntervalHours(12)).toBe(12);
    expect(normalizeDreamingIntervalHours(0)).toBe(24);
    expect(normalizeDreamingMaxGroupsPerRun(2.9)).toBe(2);
    expect(normalizeDreamingTrashRetentionDays(7)).toBe(7);
    expect(normalizeDreamingTrashRetentionDays(-1)).toBe(30);
  });
});

describe("recall merge stays stable for dreaming-adjacent selection", () => {
  it("keeps relevant ahead of recent fillers", () => {
    const out = mergeBoth(
      [{ id: "a", memory: "a", similarity: 0.9 }],
      [
        { id: "a", memory: "a", similarity: 1 },
        { id: "b", memory: "b", similarity: 1 },
      ],
      2
    );
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("clamps boosted similarity to 1", () => {
    const [hit] = applyProjectBoost(
      [{ id: "x", memory: "x", similarity: 0.99, containerTag: "p1" }],
      "p1",
      0.05
    );
    expect(hit!.similarity).toBe(1);
  });
});
