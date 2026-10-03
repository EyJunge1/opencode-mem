import { join } from "node:path";
import { mergeVscodeServersMcp } from "../formats/json.js";
import { copilotCliMcpPath, multiPathResult, vscodeUserMcpPath } from "../paths.js";
import type { InstallResult, McpLaunchSpec } from "../types.js";

export function installCopilot(
  userLaunch: McpLaunchSpec,
  projectLaunch: McpLaunchSpec,
  projectDir?: string
): InstallResult {
  // VS Code user mcp.json uses `servers` + type:stdio (not mcpServers).
  const user = mergeVscodeServersMcp(vscodeUserMcpPath(), userLaunch, "copilot");
  const cli = mergeVscodeServersMcp(copilotCliMcpPath(), userLaunch, "copilot");
  const extras = [cli];
  if (projectDir) {
    extras.push(
      mergeVscodeServersMcp(join(projectDir, ".vscode", "mcp.json"), projectLaunch, "copilot")
    );
  }
  return multiPathResult("copilot", user, extras);
}
