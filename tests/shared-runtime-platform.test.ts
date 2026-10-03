import { describe, expect, it } from "bun:test";
import {
  normalizePlatformSource,
  resolvePlatformSource,
  platformSourceFromMetadata,
  PLATFORM_SOURCE_ENV,
} from "../src/services/platform-source.js";
import { detectInstalledIdes } from "../src/cli/install.js";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setSharedRuntimeBridge,
  getSharedRuntimeBridge,
  isUsingSharedRuntime,
} from "../src/services/shared-runtime-bridge.js";
import { executeMemoryTool } from "../src/services/memory-tool/index.js";

describe("platformSource", () => {
  it("normalizes and resolves env / explicit values", () => {
    expect(normalizePlatformSource("Cursor")).toBe("cursor");
    expect(normalizePlatformSource("weird host!!")).toBe("weird-host");
    const prev = process.env[PLATFORM_SOURCE_ENV];
    process.env[PLATFORM_SOURCE_ENV] = "claude";
    try {
      expect(resolvePlatformSource()).toBe("claude");
      expect(resolvePlatformSource("opencode")).toBe("opencode");
    } finally {
      if (prev === undefined) delete process.env[PLATFORM_SOURCE_ENV];
      else process.env[PLATFORM_SOURCE_ENV] = prev;
    }
    expect(platformSourceFromMetadata({ platformSource: "web" })).toBe("web");
  });
});

describe("detectInstalledIdes", () => {
  it("finds hosts from home layout", () => {
    const home = mkdtempSync(join(tmpdir(), "opencode-mem-ide-detect-"));
    try {
      mkdirSync(join(home, ".cursor"));
      mkdirSync(join(home, ".codex"));
      mkdirSync(join(home, ".codeium", "windsurf"), { recursive: true });
      mkdirSync(join(home, ".kimi-code"));
      writeFileSync(join(home, ".claude.json"), "{}");
      const found = detectInstalledIdes(home);
      expect(found).toContain("cursor");
      expect(found).toContain("codex");
      expect(found).toContain("claude");
      expect(found).toContain("windsurf");
      expect(found).toContain("kimi");
      expect(found).not.toContain("gemini");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("shared runtime bridge", () => {
  it("routes add/search through the bridge when set", async () => {
    const calls: string[] = [];
    setSharedRuntimeBridge({
      baseUrl: "http://127.0.0.1:9",
      directory: "/tmp",
      search: async ({ query }) => {
        calls.push(`search:${query}`);
        return { success: true, results: [], hint: "memory_get" };
      },
      timeline: async ({ limit }) => {
        calls.push(`timeline:${limit ?? "default"}`);
        return { success: true, memories: [], hint: "memory_get" };
      },
      get: async () => ({ success: true, memories: [] }),
      write: async ({ action, platformSource }) => {
        calls.push(`write:${action}:${platformSource}`);
        return { success: true, id: "mem_bridge" };
      },
    });

    try {
      expect(isUsingSharedRuntime()).toBe(true);
      const add = JSON.parse(
        await executeMemoryTool(
          { mode: "add", content: "hello from bridge" },
          { directory: "/tmp", platformSource: "opencode" }
        )
      );
      expect(add.success).toBe(true);
      expect(calls).toContain("write:add:opencode");

      const search = JSON.parse(
        await executeMemoryTool(
          { mode: "search", query: "hello" },
          { directory: "/tmp", platformSource: "opencode" }
        )
      );
      expect(search.success).toBe(true);
      expect(calls).toContain("search:hello");
      expect(getSharedRuntimeBridge()?.baseUrl).toBe("http://127.0.0.1:9");
    } finally {
      setSharedRuntimeBridge(null);
      expect(isUsingSharedRuntime()).toBe(false);
    }
  });
});
