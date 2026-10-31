import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cjsEntryFromPackageJson,
  resolveTransformersCjsEntry,
  TRANSFORMERS_PACKAGE,
} from "../src/services/transformers-resolve.js";

const requireFromHere = createRequire(import.meta.url);

describe("transformers-resolve (#463)", () => {
  it("resolves the real installed CJS entry via require", () => {
    const entry = resolveTransformersCjsEntry({
      requireFn: requireFromHere,
      startPaths: [import.meta.url],
    });
    expect(entry.replaceAll("\\", "/")).toContain("@huggingface/transformers");
    expect(entry.endsWith(".cjs") || entry.endsWith(".js")).toBe(true);
  });

  it("reads CJS export path from package.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "transformers-pkg-"));
    const pkgJson = join(dir, "package.json");
    writeFileSync(
      pkgJson,
      JSON.stringify({
        name: TRANSFORMERS_PACKAGE,
        main: "./dist/transformers.node.cjs",
        exports: {
          node: {
            require: { default: "./dist/transformers.node.cjs" },
            import: { default: "./dist/transformers.node.mjs" },
          },
        },
      })
    );
    expect(cjsEntryFromPackageJson(pkgJson).replaceAll("\\", "/")).toMatch(
      /dist\/transformers\.node\.cjs$/
    );
  });

  it("finds a hoisted package by walking node_modules when require.resolve fails", () => {
    const root = mkdtempSync(join(tmpdir(), "transformers-hoist-"));
    const pluginDir = join(root, "node_modules", "opencode-mem", "dist", "services");
    const pkgDir = join(root, "node_modules", "@huggingface", "transformers");
    mkdirSync(pluginDir, { recursive: true });
    mkdirSync(join(pkgDir, "dist"), { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: TRANSFORMERS_PACKAGE,
        exports: {
          node: { require: { default: "./dist/transformers.node.cjs" } },
        },
      })
    );
    writeFileSync(join(pkgDir, "dist", "transformers.node.cjs"), "module.exports = {}");

    const fakeRequire = ((id: string) => {
      throw new Error(`Cannot find module '${id}'`);
    }) as NodeRequire;
    fakeRequire.resolve = ((_id: string) => {
      throw new Error(`Cannot find module '${_id}'`);
    }) as NodeRequire["resolve"];

    const start = join(pluginDir, "embedding.js");
    writeFileSync(start, "");
    const entry = resolveTransformersCjsEntry({
      requireFn: fakeRequire,
      startPaths: [start],
    });
    expect(entry.replaceAll("\\", "/")).toMatch(
      /node_modules\/@huggingface\/transformers\/dist\/transformers\.node\.cjs$/
    );
  });

  it("mentions cache clear / remote embeddings when unresolved", () => {
    const fakeRequire = ((id: string) => {
      throw new Error(`Cannot find module '${id}'`);
    }) as NodeRequire;
    fakeRequire.resolve = ((_id: string) => {
      throw new Error(`Cannot find module '${_id}'`);
    }) as NodeRequire["resolve"];

    expect(() =>
      resolveTransformersCjsEntry({
        requireFn: fakeRequire,
        startPaths: [join(tmpdir(), "empty-start", "embedding.js")],
      })
    ).toThrow(/#463|embeddingApiUrl|plugin cache/i);
  });
});
