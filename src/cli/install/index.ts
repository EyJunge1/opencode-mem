/**
 * Host install entrypoints. New hosts: catalog in `shared/hosts.ts`, then
 * format/adapter here — see docs/mcp.md "Adding a host".
 */
import { join } from "node:path";
import { getHostSpec, type HostId } from "../../shared/hosts.js";
import { installIdePriming } from "./priming.js";
import type { InstallIde } from "./catalog.js";
import { mergeJsonMcpServers } from "./formats/json.js";
import { mergeOpenClawServers } from "./formats/openclaw.js";
import { installTomlMcpAt } from "./formats/toml.js";
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
export { detectInstalledIdes } from "./detect.js";
export { installIdePriming } from "./priming.js";

/** Project-local session priming (rules / CLAUDE.md) for MCP-only hosts. */
function withPriming(ide: InstallIde, primary: InstallResult, projectDir?: string): InstallResult {
  const priming = installIdePriming(ide, projectDir);
  if (!priming.length) return primary;
  return multiPathResult(ide, primary, priming);
}

function installJsonHost(
  ide: HostId,
  userLaunch: McpLaunchSpec,
  projectLaunch: McpLaunchSpec,
  projectDir?: string
): InstallResult {
  const spec = getHostSpec(ide);
  const home = resolveUserHome();
  const userPath = spec.userConfigPaths(home)[0];
  if (!userPath) throw new Error(`Host ${ide} has no user config path`);

  const user = mergeJsonMcpServers(userPath, "mcpServers", userLaunch, ide);
  if (!projectDir || !spec.projectConfigRelPath) {
    return withPriming(ide, user, projectDir);
  }
  const project = mergeJsonMcpServers(
    join(projectDir, spec.projectConfigRelPath),
    "mcpServers",
    projectLaunch,
    ide
  );
  return withPriming(ide, multiPathResult(ide, user, [project]), projectDir);
}

function installTomlHost(
  ide: HostId,
  userLaunch: McpLaunchSpec,
  projectLaunch: McpLaunchSpec,
  projectDir?: string
): InstallResult {
  const spec = getHostSpec(ide);
  const home = resolveUserHome();
  const userPath = spec.userConfigPaths(home)[0];
  if (!userPath) throw new Error(`Host ${ide} has no user config path`);

  const user = installTomlMcpAt(userPath, userLaunch, ide);
  if (!projectDir || !spec.projectConfigRelPath) return user;
  const project = installTomlMcpAt(join(projectDir, spec.projectConfigRelPath), projectLaunch, ide);
  return multiPathResult(ide, user, [project]);
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
  const spec = getHostSpec(ide);

  switch (spec.configKind) {
    case "json-mcpServers":
      return installJsonHost(ide, userLaunch, projectLaunch, projectDir);
    case "toml":
      return installTomlHost(ide, userLaunch, projectLaunch, projectDir);
    case "opencode":
      return installOpencode(projectDir, userLaunch);
    case "openclaw":
      return mergeOpenClawServers(spec.userConfigPaths(resolveUserHome())[0]!, userLaunch);
    case "goose-yaml":
      return installGooseYaml(userLaunch);
    case "copilot":
      return installCopilot(userLaunch, projectLaunch, projectDir);
    default: {
      const _exhaustive: never = spec.configKind;
      throw new Error(`Unsupported IDE config kind: ${_exhaustive}`);
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
