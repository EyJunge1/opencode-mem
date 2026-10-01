import { describe, expect, it } from "bun:test";
import pkg from "../package.json";

describe("published dependency constraints", () => {
  it("uses @tursodatabase/database for local persistence (libsql kept for DiskANN migration)", () => {
    expect(pkg.dependencies["@tursodatabase/database"]).toBeTruthy();
    expect(pkg.dependencies["@libsql/client"]).toBeTruthy();
    expect(pkg.dependencies).not.toHaveProperty("usearch");
  });

  it("uses @huggingface/transformers (v4+) as the local embedding backend", () => {
    expect(pkg.dependencies["@huggingface/transformers"]).toMatch(/^\^?4\./);
    expect(pkg.dependencies).not.toHaveProperty("@xenova/transformers");
  });

  it("pins onnxruntime-node@1.20.1 as a direct dependency (nested install + Bun teardown)", () => {
    // Nested package.json overrides are ignored by npm/Arborist (#184). A direct
    // dependency is required so OpenCode nested installs keep a shipping binding.
    // Stay on 1.20.1 until OpenCode embeds Bun >1.3.14 (#225). Intel Mac
    // (darwin/x64) is unsupported — @tursodatabase/database ships no x64 binding.
    expect(pkg.dependencies["onnxruntime-node"]).toBe("1.20.1");
    expect((pkg as { overrides?: Record<string, string> }).overrides?.["onnxruntime-node"]).toBe(
      "1.20.1"
    );
  });
});
