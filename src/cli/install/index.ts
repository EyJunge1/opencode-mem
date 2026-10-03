import { join } from "node:path";
import { installIdePriming } from "../ide-priming.js";
import type { InstallIde } from "./catalog.js";
import { installJsonMcp, mergeJsonMcpServers } from "./formats/json.js";
import { mergeOpenClawServers } from "./formats/openclaw.js";
import { installTomlMcp, installTomlMcpAt } from "./formats/toml.js";
import { installGooseYaml } from "./formats/yaml-goose.js";
import { installCopilot } from "./hosts/copilot.js";
import { installOpencode } from "./hosts/opencode.js";
import { pinLaunchDirectory, resolveMcpLaunch, withoutLaunchDirectory } from "./launch.js";
import { multiPathResult, resolveProjectDir, resolveUserHome } from "./paths.js";
import type { InstallResult, McpLaunchSpec } from "./types.js";

export type { InstallIde } from "./catalog.js";
export {
  IDE_ALIASES,
  IDE_NEXT_STEPS,
  INSTALL_HOST_PLATFORM_SOURCES,
  SUPPORTED_IDES,
  parseIdeList,
  resolveIdeAlias,
} from "./catalog.js";
export type { InstallResult, McpLaunchSpec } from "./types.js";
export { pinLaunchDirectory, resolveMcpLaunch, withoutLaunchDirectory } from "./launch.js";
export { resolveUserHome } from "./paths.js";
export { mergeCodexToml, mergeTomlTableSection } from "./formats/toml.js";
export { isIdeConfigured } from "./hosts/configured.js";

/** Project-local session priming (rules / CLAUDE.md) for MCP-only hosts. */
function withPriming(ide: InstallIde, primary: InstallResult, projectDir?: string): InstallResult {
  const priming = installIdePriming(ide, projectDir);
  if (!priming.length) return primary;
  return multiPathResult(ide, primary, priming);
}

export function installIde(
  ide: InstallIde,
  options: { projectDir?: string; launch?: McpLaunchSpec } = {}
): InstallResult {
  const projectDir = resolveProjectDir(options.projectDir);
  const baseLaunch =
    options.launch ?? resolveMcpLaunch(projectDir, ide === "opencode" ? "opencode" : ide);
  // User-global configs must not pin a single project directory.
  const userLaunch = withoutLaunchDirectory(baseLaunch);
  const projectLaunch = pinLaunchDirectory(userLaunch, projectDir);

  switch (ide) {
    case "cursor": {
      const user = installJsonMcp("cursor", join(".cursor", "mcp.json"), userLaunch);
      if (!projectDir) return user;
      const project = mergeJsonMcpServers(
        join(projectDir, ".cursor", "mcp.json"),
        "mcpServers",
        projectLaunch,
        "cursor"
      );
      return withPriming("cursor", multiPathResult("cursor", user, [project]), projectDir);
    }
    case "claude": {
      const user = installJsonMcp("claude", ".claude.json", userLaunch);
      if (!projectDir) return user;
      const project = mergeJsonMcpServers(
        join(projectDir, ".mcp.json"),
        "mcpServers",
        projectLaunch,
        "claude"
      );
      return withPriming("claude", multiPathResult("claude", user, [project]), projectDir);
    }
    case "codex": {
      const user = installTomlMcp("codex", join(".codex", "config.toml"), userLaunch);
      if (!projectDir) return user;
      const project = installTomlMcpAt(
        join(projectDir, ".codex", "config.toml"),
        projectLaunch,
        "codex"
      );
      return multiPathResult("codex", user, [project]);
    }
    case "gemini": {
      const primary = installJsonMcp("gemini", join(".gemini", "settings.json"), userLaunch);
      if (!projectDir) return primary;
      const project = mergeJsonMcpServers(
        join(projectDir, ".gemini", "settings.json"),
        "mcpServers",
        projectLaunch,
        "gemini"
      );
      return withPriming("gemini", multiPathResult("gemini", primary, [project]), projectDir);
    }
    case "antigravity": {
      // Official: ~/.gemini/config/mcp_config.json + project .agents/mcp_config.json
      const primary = mergeJsonMcpServers(
        join(resolveUserHome(), ".gemini", "config", "mcp_config.json"),
        "mcpServers",
        userLaunch,
        "antigravity"
      );
      if (!projectDir) return primary;
      const project = mergeJsonMcpServers(
        join(projectDir, ".agents", "mcp_config.json"),
        "mcpServers",
        projectLaunch,
        "antigravity"
      );
      return withPriming(
        "antigravity",
        multiPathResult("antigravity", primary, [project]),
        projectDir
      );
    }
    case "opencode":
      return installOpencode(projectDir, userLaunch);
    case "windsurf": {
      // Official: only global ~/.codeium/windsurf/mcp_config.json
      const primary = installJsonMcp(
        "windsurf",
        join(".codeium", "windsurf", "mcp_config.json"),
        userLaunch
      );
      return withPriming("windsurf", primary, projectDir);
    }
    case "kimi": {
      const json = installJsonMcp("kimi", join(".kimi-code", "mcp.json"), userLaunch);
      if (!projectDir) return json;
      const project = mergeJsonMcpServers(
        join(projectDir, ".kimi-code", "mcp.json"),
        "mcpServers",
        projectLaunch,
        "kimi"
      );
      return withPriming("kimi", multiPathResult("kimi", json, [project]), projectDir);
    }
    case "openclaw":
      return mergeOpenClawServers(
        join(resolveUserHome(), ".openclaw", "openclaw.json"),
        userLaunch
      );
    case "goose":
      return installGooseYaml(userLaunch);
    case "warp": {
      // Official: ~/.warp/.mcp.json (+ project .warp/.mcp.json)
      const user = mergeJsonMcpServers(
        join(resolveUserHome(), ".warp", ".mcp.json"),
        "mcpServers",
        userLaunch,
        "warp"
      );
      if (!projectDir) return user;
      const project = mergeJsonMcpServers(
        join(projectDir, ".warp", ".mcp.json"),
        "mcpServers",
        projectLaunch,
        "warp"
      );
      return multiPathResult("warp", user, [project]);
    }
    case "copilot":
      return installCopilot(userLaunch, projectLaunch, projectDir);
    case "grok": {
      const user = installTomlMcp("grok", join(".grok", "config.toml"), userLaunch);
      if (!projectDir) return user;
      const project = installTomlMcpAt(
        join(projectDir, ".grok", "config.toml"),
        projectLaunch,
        "grok"
      );
      return multiPathResult("grok", user, [project]);
    }
    default: {
      const _exhaustive: never = ide;
      throw new Error(`Unsupported IDE: ${_exhaustive}`);
    }
  }
}

export function runInstall(options: { ides: InstallIde[]; projectDir?: string }): InstallResult[] {
  const projectDir = resolveProjectDir(options.projectDir);
  return options.ides.map((ide) =>
    installIde(ide, {
      projectDir,
      launch: resolveMcpLaunch(projectDir, ide === "opencode" ? "opencode" : ide),
    })
  );
}
