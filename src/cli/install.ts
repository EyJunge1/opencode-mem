/**
 * Public CLI install API.
 * Implementation lives in `./install/` (catalog, formats, hosts).
 */
export {
  IDE_ALIASES,
  IDE_NEXT_STEPS,
  INSTALL_HOST_PLATFORM_SOURCES,
  SUPPORTED_IDES,
  installIde,
  isIdeConfigured,
  mergeCodexToml,
  mergeTomlTableSection,
  parseIdeList,
  pinLaunchDirectory,
  resolveIdeAlias,
  resolveMcpLaunch,
  resolveUserHome,
  runInstall,
  withoutLaunchDirectory,
  type InstallIde,
  type InstallResult,
  type McpLaunchSpec,
} from "./install/index.js";
