import { join } from "node:path";
import type { InstallIde } from "../catalog.js";
import { jsonHasMcpServer } from "../formats/json.js";
import { openClawHasMcp } from "../formats/openclaw.js";
import { tomlHasMcp } from "../formats/toml.js";
import { gooseHasMcp } from "../formats/yaml-goose.js";
import { copilotCliMcpPath, resolveUserHome, vscodeUserMcpPath } from "../paths.js";
import { opencodeIsConfigured } from "./opencode.js";

/**
 * Whether a host config file already contains an opencode-mem MCP / plugin entry.
 * Used by `status` to show install coverage without mutating files.
 */
export function isIdeConfigured(ide: InstallIde): boolean {
  const home = resolveUserHome();
  try {
    switch (ide) {
      case "cursor":
        return jsonHasMcpServer(join(home, ".cursor", "mcp.json"));
      case "claude":
        return jsonHasMcpServer(join(home, ".claude.json"));
      case "codex":
        return tomlHasMcp(join(home, ".codex", "config.toml"));
      case "gemini":
        return jsonHasMcpServer(join(home, ".gemini", "settings.json"));
      case "antigravity":
        return jsonHasMcpServer(join(home, ".gemini", "config", "mcp_config.json"));
      case "opencode":
        return opencodeIsConfigured();
      case "windsurf":
        return jsonHasMcpServer(join(home, ".codeium", "windsurf", "mcp_config.json"));
      case "kimi":
        return jsonHasMcpServer(join(home, ".kimi-code", "mcp.json"));
      case "openclaw":
        return openClawHasMcp(join(home, ".openclaw", "openclaw.json"));
      case "goose":
        return gooseHasMcp(join(home, ".config", "goose", "config.yaml"));
      case "warp":
        return jsonHasMcpServer(join(home, ".warp", ".mcp.json"));
      case "copilot":
        return jsonHasMcpServer(vscodeUserMcpPath()) || jsonHasMcpServer(copilotCliMcpPath());
      case "grok":
        return tomlHasMcp(join(home, ".grok", "config.toml"));
      default: {
        const _exhaustive: never = ide;
        void _exhaustive;
        return false;
      }
    }
  } catch {
    return false;
  }
}
