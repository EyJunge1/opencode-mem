import { detectInstalledIdes } from "../ide-detect.js";

/**
 * Coding agents / harnesses we can wire via MCP.
 * Native OpenCode plugin remains first-class; everything else gets MCP config.
 *
 * Single source of truth for installable host IDs — PlatformSource host labels
 * are derived from this list (plus non-host provenance like web/import).
 */
export type InstallIde =
  | "cursor"
  | "claude"
  | "codex"
  | "gemini"
  | "antigravity"
  | "opencode"
  | "windsurf"
  | "kimi"
  | "openclaw"
  | "goose"
  | "warp"
  | "copilot"
  | "grok";

export const SUPPORTED_IDES: InstallIde[] = [
  "cursor",
  "claude",
  "codex",
  "gemini",
  "antigravity",
  "opencode",
  "windsurf",
  "kimi",
  "openclaw",
  "goose",
  "warp",
  "copilot",
  "grok",
];

/** Host labels that appear as `platformSource` provenance for coding agents. */
export const INSTALL_HOST_PLATFORM_SOURCES: readonly InstallIde[] = SUPPORTED_IDES;

/** Common aliases from docs / host CLIs → canonical InstallIde. */
export const IDE_ALIASES: Record<string, InstallIde> = {
  "codex-cli": "codex",
  "claude-code": "claude",
  "github-copilot": "copilot",
  "antigravity-cli": "antigravity",
};

/** Restart / enable hints shown after install. */
export const IDE_NEXT_STEPS: Record<InstallIde, string> = {
  cursor: "Restart Cursor (MCP → Tools) so opencode-mem loads",
  claude: "Restart Claude Code / Claude Desktop so MCP tools appear",
  codex: "Restart Codex CLI, then verify with /mcp",
  gemini: "Restart Gemini CLI so ~/.gemini MCP settings reload",
  antigravity: "Restart Antigravity / Gemini so mcp_config reloads",
  opencode: "Restart OpenCode — plugin + MCP both registered",
  windsurf: "Restart Windsurf so mcp_config.json reloads",
  kimi: "Restart Kimi Code so mcp.json + config.toml reload",
  openclaw: "Restart OpenClaw so ~/.openclaw/mcp.json reloads",
  goose: "Restart Goose so the opencode-mem extension loads",
  warp: "Restart Warp so ~/.warp/mcp.json reloads",
  copilot: "Reload VS Code / Copilot Chat window so User mcp.json loads",
  grok: "Restart Grok so ~/.grok/mcp.json reloads",
};

export function resolveIdeAlias(raw: string): string {
  return IDE_ALIASES[raw] ?? raw;
}

export function parseIdeList(raw: string | undefined): InstallIde[] {
  if (!raw || !raw.trim()) {
    throw new Error(`Missing --ide. Use one of: ${SUPPORTED_IDES.join(", ")}, all, or auto`);
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "all") return [...SUPPORTED_IDES];
  if (normalized === "auto") {
    const detected = detectInstalledIdes();
    if (detected.length === 0) {
      throw new Error(
        "No coding agents detected under your home directory. Pass --ide explicitly."
      );
    }
    return detected;
  }

  const parts = raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const out: InstallIde[] = [];
  for (const part of parts) {
    if (part === "auto" || part === "all") {
      throw new Error(`Use --ide ${part} alone, not mixed with other values`);
    }
    const aliased = resolveIdeAlias(part);
    if (!SUPPORTED_IDES.includes(aliased as InstallIde)) {
      throw new Error(`Unknown IDE "${part}". Supported: ${SUPPORTED_IDES.join(", ")}, all, auto`);
    }
    if (!out.includes(aliased as InstallIde)) out.push(aliased as InstallIde);
  }
  return out;
}
