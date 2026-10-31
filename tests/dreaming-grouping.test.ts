import { describe, expect, it } from "bun:test";
import {
  groupRelatedMemoryEntries,
  isDreamingCrossProjectEnabled,
  type DreamingMemoryEntry,
} from "../src/services/dreaming-service.js";
import { CONFIG } from "../src/config.js";

function vec(...values: number[]): Float32Array {
  return new Float32Array(values);
}

function entry(
  id: string,
  containerTag: string,
  vector: Float32Array,
  createdAt = 1
): DreamingMemoryEntry {
  return { id, content: id, containerTag, createdAt, vector };
}

describe("groupRelatedMemoryEntries", () => {
  it("groups related pairs at relatedThreshold but not only near-dup 0.9", () => {
    // Identical direction → similarity 1.0 is excluded (< 1.0 required).
    // Nearly parallel vectors → high similarity (~0.99).
    // Distinct-ish vectors → ~0.8 range.
    const a = entry("a", "p1", vec(1, 0, 0));
    const b = entry("b", "p1", vec(0.8, 0.6, 0)); // cos ≈ 0.8
    const c = entry("c", "p1", vec(0, 1, 0)); // cos with a = 0

    const at075 = groupRelatedMemoryEntries([a, b, c], {
      threshold: 0.75,
      allowCrossTag: false,
      scope: "project",
    });
    expect(at075).toHaveLength(1);
    expect(at075[0]!.representative.id).toBe("a");
    expect(at075[0]!.duplicates.map((d) => d.id)).toEqual(["b"]);

    const at09 = groupRelatedMemoryEntries([a, b, c], {
      threshold: 0.9,
      allowCrossTag: false,
      scope: "project",
    });
    expect(at09).toHaveLength(0);
  });

  it("keeps same-tag only when cross-tag is disabled", () => {
    const a = entry("a", "p1", vec(1, 0));
    const b = entry("b", "p2", vec(0.99, 0.01));
    const groups = groupRelatedMemoryEntries([a, b], {
      threshold: 0.75,
      allowCrossTag: false,
      scope: "project",
    });
    expect(groups).toHaveLength(0);
  });

  it("allows cross-tag grouping when enabled", () => {
    const a = entry("a", "p1", vec(1, 0));
    const b = entry("b", "p2", vec(0.99, 0.01));
    const groups = groupRelatedMemoryEntries([a, b], {
      threshold: 0.75,
      allowCrossTag: true,
      scope: "project",
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.duplicates[0]!.containerTag).toBe("p2");
  });

  it("caps group size", () => {
    const base = entry("r", "p1", vec(1, 0, 0));
    const others = [0.1, 0.15, 0.2, 0.25, 0.3].map((y, i) =>
      entry(`d${i}`, "p1", vec(1, y, 0), i + 2)
    );
    const groups = groupRelatedMemoryEntries([base, ...others], {
      threshold: 0.7,
      allowCrossTag: false,
      scope: "project",
      maxGroupSize: 3,
    });
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups.every((g) => g.duplicates.length <= 2)).toBe(true);
    expect(groups[0]!.duplicates.length).toBe(2);
  });
});

describe("isDreamingCrossProjectEnabled", () => {
  it("follows dreaming.crossProject or memory.defaultScope", () => {
    const prevCross = CONFIG.dreaming.crossProject;
    const prevScope = CONFIG.memory.defaultScope;
    try {
      CONFIG.dreaming.crossProject = false;
      CONFIG.memory.defaultScope = "project";
      expect(isDreamingCrossProjectEnabled()).toBe(false);

      CONFIG.memory.defaultScope = "all-projects";
      expect(isDreamingCrossProjectEnabled()).toBe(true);

      CONFIG.memory.defaultScope = "project";
      CONFIG.dreaming.crossProject = true;
      expect(isDreamingCrossProjectEnabled()).toBe(true);
    } finally {
      CONFIG.dreaming.crossProject = prevCross;
      CONFIG.memory.defaultScope = prevScope;
    }
  });
});
