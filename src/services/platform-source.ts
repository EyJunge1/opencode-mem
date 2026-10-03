/**
 * Multi-agent provenance for memories.
 * Stored in memory metadata JSON — no schema migration required.
 */

const KNOWN: ReadonlySet<string> = new Set([
  "opencode",
  "mcp",
  "web",
  "cursor",
  "claude",
  "codex",
  "gemini",
  "antigravity",
  "windsurf",
  "kimi",
  "openclaw",
  "goose",
  "warp",
  "copilot",
  "grok",
  "import",
  "unknown",
]);

export type PlatformSource =
  | "opencode"
  | "mcp"
  | "web"
  | "cursor"
  | "claude"
  | "codex"
  | "gemini"
  | "antigravity"
  | "windsurf"
  | "kimi"
  | "openclaw"
  | "goose"
  | "warp"
  | "copilot"
  | "grok"
  | "import"
  | "unknown";

/** Env override used by MCP hosts / install snippets. */
export const PLATFORM_SOURCE_ENV = "OPENCODE_MEM_PLATFORM";

export function normalizePlatformSource(raw: unknown): PlatformSource {
  if (typeof raw !== "string") return "unknown";
  const value = raw.trim().toLowerCase();
  if (!value) return "unknown";
  if (KNOWN.has(value)) return value as PlatformSource;
  // Allow custom host labels (e.g. "windsurf") without rejecting writes.
  return value
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) as PlatformSource;
}

export function resolvePlatformSource(explicit?: string | null): PlatformSource {
  if (explicit) return normalizePlatformSource(explicit);
  const fromEnv = process.env[PLATFORM_SOURCE_ENV];
  if (fromEnv) return normalizePlatformSource(fromEnv);
  return "unknown";
}

export function platformSourceFromMetadata(metadata: unknown): PlatformSource | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as Record<string, unknown>).platformSource;
  if (typeof value !== "string" || !value.trim()) return undefined;
  return normalizePlatformSource(value);
}
