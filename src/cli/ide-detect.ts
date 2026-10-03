import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { InstallIde } from "./install.js";

function userHome(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function vscodeUserDir(home: string): string {
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Code");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    return join(appData, "Code");
  }
  return join(home, ".config", "Code");
}

/**
 * Detect installed coding-agent hosts by well-known config / app directories.
 */
export function detectInstalledIdes(home = userHome()): InstallIde[] {
  const found: InstallIde[] = [];

  const checks: Array<{ ide: InstallIde; paths: string[] }> = [
    {
      ide: "cursor",
      paths: [join(home, ".cursor"), join(home, "Library", "Application Support", "Cursor")],
    },
    {
      ide: "claude",
      paths: [join(home, ".claude"), join(home, ".claude.json")],
    },
    {
      ide: "codex",
      paths: [join(home, ".codex")],
    },
    {
      ide: "gemini",
      paths: [join(home, ".gemini")],
    },
    {
      ide: "antigravity",
      paths: [join(home, ".gemini", "config"), join(home, ".gemini", "antigravity")],
    },
    {
      ide: "opencode",
      paths: [join(home, ".config", "opencode"), join(home, ".opencode")],
    },
    {
      ide: "windsurf",
      paths: [
        join(home, ".codeium", "windsurf"),
        join(home, "Library", "Application Support", "Windsurf"),
      ],
    },
    {
      ide: "kimi",
      paths: [join(home, ".kimi-code")],
    },
    {
      ide: "openclaw",
      paths: [join(home, ".openclaw")],
    },
    {
      ide: "goose",
      paths: [join(home, ".config", "goose")],
    },
    {
      ide: "warp",
      paths: [join(home, ".warp")],
    },
    {
      ide: "copilot",
      paths: [vscodeUserDir(home), join(home, ".copilot")],
    },
    {
      ide: "grok",
      paths: [join(home, ".grok")],
    },
  ];

  for (const check of checks) {
    if (check.paths.some((p) => existsSync(p))) {
      found.push(check.ide);
    }
  }

  return found;
}
