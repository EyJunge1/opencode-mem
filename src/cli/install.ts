import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { detectInstalledIdes } from "./ide-detect.js";

/** Prefer HOME/USERPROFILE so tests and custom environments can redirect writes. */
export function resolveUserHome(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function resolveProjectDir(projectDir?: string): string | undefined {
  if (!projectDir) return undefined;
  return isAbsolute(projectDir) ? projectDir : resolve(projectDir);
}

/**
 * Coding agents / harnesses we can wire via MCP.
 * Native OpenCode plugin remains first-class; everything else gets MCP config.
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

export interface McpLaunchSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface InstallResult {
  ide: InstallIde;
  path: string;
  action: "created" | "updated" | "unchanged";
  detail: string;
  /** Extra config paths written for the same host (project-local, dual formats). */
  also?: string[];
}

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
    // Common aliases from docs / host CLIs
    const aliased =
      part === "codex-cli"
        ? "codex"
        : part === "claude-code"
          ? "claude"
          : part === "github-copilot"
            ? "copilot"
            : part === "antigravity-cli"
              ? "antigravity"
              : part;
    if (!SUPPORTED_IDES.includes(aliased as InstallIde)) {
      throw new Error(`Unknown IDE "${part}". Supported: ${SUPPORTED_IDES.join(", ")}, all, auto`);
    }
    if (!out.includes(aliased as InstallIde)) out.push(aliased as InstallIde);
  }
  return out;
}

/**
 * Prefer the currently running CLI entry (local checkout / installed bin).
 * Fall back to `npx -y opencode-mem mcp` for portable host configs.
 *
 * Does NOT pin OPENCODE_MEM_DIRECTORY — user-global configs must follow the
 * host cwd. Use `pinLaunchDirectory` only for project-scoped writes.
 */
export function resolveMcpLaunch(
  projectDir?: string,
  platformSource: string = "mcp"
): McpLaunchSpec {
  // projectDir kept for call-site compat; intentionally not baked into env here.
  void projectDir;
  const entry = process.argv[1];
  const env: Record<string, string> = {
    OPENCODE_MEM_PLATFORM: platformSource,
  };

  if (entry && (entry.endsWith(".js") || entry.endsWith(".ts") || entry.endsWith(".mjs"))) {
    return {
      command: process.execPath,
      args: [resolve(entry), "mcp"],
      env,
    };
  }

  return {
    command: "npx",
    args: ["-y", "opencode-mem", "mcp"],
    env,
  };
}

/** Pin shard directory for project-local MCP configs only. */
export function pinLaunchDirectory(launch: McpLaunchSpec, projectDir?: string): McpLaunchSpec {
  const resolved = resolveProjectDir(projectDir);
  if (!resolved) return launch;
  return {
    ...launch,
    env: {
      ...(launch.env ?? {}),
      OPENCODE_MEM_DIRECTORY: resolved,
    },
  };
}

/** Strip directory pin so user-global configs stay multi-project safe. */
export function withoutLaunchDirectory(launch: McpLaunchSpec): McpLaunchSpec {
  if (!launch.env?.OPENCODE_MEM_DIRECTORY) return launch;
  const env = { ...launch.env };
  delete env.OPENCODE_MEM_DIRECTORY;
  return { ...launch, env };
}

function combineActions(actions: Array<InstallResult["action"]>): InstallResult["action"] {
  if (actions.some((a) => a === "created") && actions.every((a) => a === "created")) {
    return "created";
  }
  if (actions.every((a) => a === "unchanged")) return "unchanged";
  if (actions.some((a) => a === "created" || a === "updated")) return "updated";
  return "unchanged";
}

function multiPathResult(
  ide: InstallIde,
  primary: InstallResult,
  extras: InstallResult[]
): InstallResult {
  const also = extras.map((e) => e.path);
  return {
    ide,
    path: primary.path,
    action: combineActions([primary.action, ...extras.map((e) => e.action)]),
    detail: extras.length === 0 ? primary.detail : `${primary.detail}; also ${also.join(", ")}`,
    also: also.length > 0 ? also : undefined,
  };
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object in ${path}`);
  }
  return parsed as Record<string, unknown>;
}

function writeJsonFile(path: string, data: Record<string, unknown>): void {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

function mcpServerEntry(launch: McpLaunchSpec): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    command: launch.command,
    args: launch.args,
  };
  if (launch.env && Object.keys(launch.env).length > 0) {
    entry.env = launch.env;
  }
  return entry;
}

function fileAction(before: string, after: string): InstallResult["action"] {
  if (!before) return "created";
  if (before === after) return "unchanged";
  return "updated";
}

function mergeJsonMcpServers(
  path: string,
  key: "mcpServers" | "mcp",
  launch: McpLaunchSpec,
  ide: InstallIde,
  serverName = "opencode-mem"
): InstallResult {
  const before = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const data = readJsonFile(path);
  const existing =
    data[key] && typeof data[key] === "object" && !Array.isArray(data[key])
      ? ({ ...(data[key] as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  existing[serverName] = mcpServerEntry(launch);
  data[key] = existing;
  writeJsonFile(path, data);
  const after = readFileSync(path, "utf-8");
  return {
    ide,
    path,
    action: fileAction(before, after),
    detail: `${key}.${serverName} → ${launch.command} ${launch.args.join(" ")}`,
  };
}

/** VS Code / Copilot project format uses `servers` + type:stdio. */
function mergeVscodeServersMcp(
  path: string,
  launch: McpLaunchSpec,
  ide: InstallIde,
  serverName = "opencode-mem"
): InstallResult {
  const before = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const data = readJsonFile(path);
  const existing =
    data.servers && typeof data.servers === "object" && !Array.isArray(data.servers)
      ? ({ ...(data.servers as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const entry: Record<string, unknown> = {
    type: "stdio",
    command: launch.command,
    args: launch.args,
  };
  if (launch.env && Object.keys(launch.env).length > 0) {
    entry.env = launch.env;
  }
  existing[serverName] = entry;
  data.servers = existing;
  writeJsonFile(path, data);
  const after = readFileSync(path, "utf-8");
  return {
    ide,
    path,
    action: fileAction(before, after),
    detail: `servers.${serverName} → ${launch.command} ${launch.args.join(" ")}`,
  };
}

function escapeTomlBasic(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatTomlMcpSection(
  launch: McpLaunchSpec,
  tableName = "mcp_servers.opencode-mem"
): string {
  const lines = [
    `[${tableName}]`,
    `command = "${escapeTomlBasic(launch.command)}"`,
    `args = [${launch.args.map((a) => `"${escapeTomlBasic(a)}"`).join(", ")}]`,
  ];
  if (launch.env && Object.keys(launch.env).length > 0) {
    const parts = Object.entries(launch.env).map(([k, v]) => `${k} = "${escapeTomlBasic(v)}"`);
    lines.push(`env = { ${parts.join(", ")} }`);
  }
  return `${lines.join("\n")}\n`;
}

/** Replace or append a TOML table section (Codex / Kimi-style). */
export function mergeTomlTableSection(existing: string, section: string, marker: string): string {
  const trimmedSection = section.trimEnd() + "\n";
  if (!existing.trim()) return trimmedSection;

  const start = existing.indexOf(marker);
  if (start === -1) {
    const base = existing.trimEnd();
    return `${base}\n\n${trimmedSection}`;
  }

  const rest = existing.slice(start + marker.length);
  const nextHeader = rest.search(/\n\[/);
  const end = nextHeader === -1 ? existing.length : start + marker.length + nextHeader;
  return `${existing.slice(0, start).trimEnd()}\n\n${trimmedSection}${existing
    .slice(end)
    .replace(/^\n+/, "")}`;
}

/** @deprecated use mergeTomlTableSection — kept for tests */
export function mergeCodexToml(existing: string, section: string): string {
  return mergeTomlTableSection(existing, section, "[mcp_servers.opencode-mem]");
}

function installTomlMcpAt(path: string, launch: McpLaunchSpec, ide: InstallIde): InstallResult {
  const before = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const section = formatTomlMcpSection(launch);
  const after = mergeTomlTableSection(before, section, "[mcp_servers.opencode-mem]");
  ensureParentDir(path);
  writeFileSync(path, after.endsWith("\n") ? after : `${after}\n`, { mode: 0o600 });
  return {
    ide,
    path,
    action: fileAction(before, after),
    detail: `mcp_servers.opencode-mem → ${launch.command} ${launch.args.join(" ")}`,
  };
}

function installTomlMcp(
  ide: InstallIde,
  relativePath: string,
  launch: McpLaunchSpec
): InstallResult {
  return installTomlMcpAt(join(resolveUserHome(), relativePath), launch, ide);
}

function gooseEnvBlock(launch: McpLaunchSpec, indent = "    "): string {
  if (!launch.env || Object.keys(launch.env).length === 0) return "";
  return `${indent}envs:\n${Object.entries(launch.env)
    .map(([k, v]) => `${indent}  ${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n`;
}

function installGooseYaml(launch: McpLaunchSpec): InstallResult {
  const path = join(resolveUserHome(), ".config", "goose", "config.yaml");
  const before = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const envBlock = gooseEnvBlock(launch);
  const block = [
    `extensions:`,
    `  opencode-mem:`,
    `    enabled: true`,
    `    type: stdio`,
    `    name: opencode-mem`,
    `    cmd: ${JSON.stringify(launch.command)}`,
    `    args:`,
    ...launch.args.map((a) => `      - ${JSON.stringify(a)}`),
    ...(envBlock ? envBlock.trimEnd().split("\n") : []),
    ``,
  ].join("\n");

  const extensionSnippet = `  opencode-mem:\n    enabled: true\n    type: stdio\n    name: opencode-mem\n    cmd: ${JSON.stringify(launch.command)}\n    args:\n${launch.args.map((a) => `      - ${JSON.stringify(a)}\n`).join("")}${envBlock}`;

  let after: string;
  if (!before.trim()) {
    after = block;
  } else if (
    /^\s*opencode-mem\s*:/m.test(before) ||
    /extensions:[\s\S]*opencode-mem:/m.test(before)
  ) {
    // Replace existing opencode-mem extension block under extensions:
    after = before.replace(/(\n)?[ \t]*opencode-mem:\n(?:[ \t]+.+\n)*/m, `\n${extensionSnippet}`);
    if (after === before && !before.includes("extensions:")) {
      after = `${before.trimEnd()}\n\n${block}`;
    } else if (after === before) {
      after = `${before.trimEnd()}\n${extensionSnippet}`;
    }
  } else if (before.includes("extensions:")) {
    after = `${before.trimEnd()}\n${extensionSnippet}`;
  } else {
    after = `${before.trimEnd()}\n\n${block}`;
  }

  ensureParentDir(path);
  writeFileSync(path, after.endsWith("\n") ? after : `${after}\n`, { mode: 0o600 });
  return {
    ide: "goose",
    path,
    action: fileAction(before, after),
    detail: `extensions.opencode-mem → ${launch.command} ${launch.args.join(" ")}`,
  };
}

/** OpenClaw: mcp.servers inside ~/.openclaw/openclaw.json */
function mergeOpenClawServers(path: string, launch: McpLaunchSpec): InstallResult {
  const before = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const data = readJsonFile(path);
  const mcp =
    data.mcp && typeof data.mcp === "object" && !Array.isArray(data.mcp)
      ? ({ ...(data.mcp as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const servers =
    mcp.servers && typeof mcp.servers === "object" && !Array.isArray(mcp.servers)
      ? ({ ...(mcp.servers as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  servers["opencode-mem"] = mcpServerEntry(launch);
  mcp.servers = servers;
  data.mcp = mcp;
  writeJsonFile(path, data);
  const after = readFileSync(path, "utf-8");
  return {
    ide: "openclaw",
    path,
    action: fileAction(before, after),
    detail: `mcp.servers.opencode-mem → ${launch.command} ${launch.args.join(" ")}`,
  };
}

function installOpencode(projectDir?: string, launch?: McpLaunchSpec): InstallResult {
  const path = join(resolveUserHome(), ".config", "opencode", "opencode.json");
  const before = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const data = readJsonFile(path);
  const plugins = Array.isArray(data.plugins)
    ? [...(data.plugins as unknown[])]
    : Array.isArray(data.plugin)
      ? [...(data.plugin as unknown[])]
      : [];

  const wanted = "opencode-mem@latest";
  const hasMem = plugins.some(
    (p) => typeof p === "string" && (p === "opencode-mem" || p.startsWith("opencode-mem@"))
  );
  if (!hasMem) plugins.push(wanted);

  if (Array.isArray(data.plugins) || !Array.isArray(data.plugin)) {
    data.plugins = plugins;
  } else {
    data.plugin = plugins;
  }

  // Also register progressive MCP tools (plugin = deep hooks; MCP = memory_search/get/write).
  const userLaunch = withoutLaunchDirectory(launch ?? resolveMcpLaunch(undefined, "opencode"));
  const mcpExisting =
    data.mcp && typeof data.mcp === "object" && !Array.isArray(data.mcp)
      ? ({ ...(data.mcp as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const userMcpEntry: Record<string, unknown> = {
    type: "local",
    command: [userLaunch.command, ...userLaunch.args],
    enabled: true,
    environment: {
      ...(userLaunch.env ?? {}),
      OPENCODE_MEM_PLATFORM: "opencode",
    },
  };
  mcpExisting["opencode-mem"] = userMcpEntry;
  data.mcp = mcpExisting;

  writeJsonFile(path, data);
  const after = readFileSync(path, "utf-8");

  const extras: InstallResult[] = [];
  // Project-local opencode.json when --cwd points at a repo.
  if (projectDir) {
    const projectPath = join(projectDir, "opencode.json");
    if (existsSync(projectPath) || existsSync(join(projectDir, ".git"))) {
      const projectLaunch = pinLaunchDirectory(userLaunch, projectDir);
      const projectMcpEntry: Record<string, unknown> = {
        type: "local",
        command: [projectLaunch.command, ...projectLaunch.args],
        enabled: true,
        cwd: projectDir,
        environment: {
          ...(projectLaunch.env ?? {}),
          OPENCODE_MEM_PLATFORM: "opencode",
        },
      };
      const projectBefore = existsSync(projectPath) ? readFileSync(projectPath, "utf-8") : "";
      const projectData = readJsonFile(projectPath);
      const projectMcp =
        projectData.mcp && typeof projectData.mcp === "object" && !Array.isArray(projectData.mcp)
          ? ({ ...(projectData.mcp as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      projectMcp["opencode-mem"] = projectMcpEntry;
      projectData.mcp = projectMcp;
      writeJsonFile(projectPath, projectData);
      const projectAfter = readFileSync(projectPath, "utf-8");
      extras.push({
        ide: "opencode",
        path: projectPath,
        action: fileAction(projectBefore, projectAfter),
        detail: `mcp.opencode-mem (project)`,
      });
    }
  }

  const primary: InstallResult = {
    ide: "opencode",
    path,
    action: fileAction(before, after),
    detail: hasMem
      ? `plugin + mcp.opencode-mem${projectDir ? ` (cwd=${projectDir})` : ""}`
      : `added ${wanted} + mcp.opencode-mem`,
  };
  return multiPathResult("opencode", primary, extras);
}

function installJsonMcp(
  ide: InstallIde,
  relativePath: string,
  launch: McpLaunchSpec,
  key: "mcpServers" | "mcp" = "mcpServers"
): InstallResult {
  return mergeJsonMcpServers(join(resolveUserHome(), relativePath), key, launch, ide);
}

function vscodeUserMcpPath(): string {
  const home = resolveUserHome();
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Code", "User", "mcp.json");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    return join(appData, "Code", "User", "mcp.json");
  }
  return join(home, ".config", "Code", "User", "mcp.json");
}

function copilotCliMcpPath(): string {
  return join(resolveUserHome(), ".copilot", "mcp-config.json");
}

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
      case "opencode": {
        const path = join(home, ".config", "opencode", "opencode.json");
        if (!existsSync(path)) return false;
        const data = readJsonFile(path);
        const plugins = Array.isArray(data.plugins)
          ? data.plugins
          : Array.isArray(data.plugin)
            ? data.plugin
            : [];
        const hasPlugin = plugins.some(
          (p) => typeof p === "string" && (p === "opencode-mem" || p.startsWith("opencode-mem@"))
        );
        const mcp =
          data.mcp && typeof data.mcp === "object" && !Array.isArray(data.mcp)
            ? (data.mcp as Record<string, unknown>)
            : {};
        return hasPlugin || Boolean(mcp["opencode-mem"]);
      }
      case "windsurf":
        return jsonHasMcpServer(join(home, ".codeium", "windsurf", "mcp_config.json"));
      case "kimi":
        return jsonHasMcpServer(join(home, ".kimi-code", "mcp.json"));
      case "openclaw":
        return openClawHasMcp(join(home, ".openclaw", "openclaw.json"));
      case "goose": {
        const path = join(home, ".config", "goose", "config.yaml");
        if (!existsSync(path)) return false;
        return /opencode-mem\s*:/.test(readFileSync(path, "utf-8"));
      }
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

function jsonHasMcpServer(path: string, name = "opencode-mem"): boolean {
  if (!existsSync(path)) return false;
  const data = readJsonFile(path);
  for (const key of ["mcpServers", "mcp", "servers"] as const) {
    const block = data[key];
    if (block && typeof block === "object" && !Array.isArray(block) && name in block) {
      return true;
    }
  }
  return false;
}

function openClawHasMcp(path: string, name = "opencode-mem"): boolean {
  if (!existsSync(path)) return false;
  const data = readJsonFile(path);
  const mcp = data.mcp;
  if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) return false;
  const servers = (mcp as Record<string, unknown>).servers;
  return Boolean(
    servers && typeof servers === "object" && !Array.isArray(servers) && name in servers
  );
}

function tomlHasMcp(path: string): boolean {
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf-8").includes("[mcp_servers.opencode-mem]");
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
      return multiPathResult("cursor", user, [project]);
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
      return multiPathResult("claude", user, [project]);
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
      return multiPathResult("gemini", primary, [project]);
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
      return multiPathResult("antigravity", primary, [project]);
    }
    case "opencode":
      return installOpencode(projectDir, userLaunch);
    case "windsurf":
      // Official: only global ~/.codeium/windsurf/mcp_config.json
      return installJsonMcp(
        "windsurf",
        join(".codeium", "windsurf", "mcp_config.json"),
        userLaunch
      );
    case "kimi": {
      const json = installJsonMcp("kimi", join(".kimi-code", "mcp.json"), userLaunch);
      if (!projectDir) return json;
      const project = mergeJsonMcpServers(
        join(projectDir, ".kimi-code", "mcp.json"),
        "mcpServers",
        projectLaunch,
        "kimi"
      );
      return multiPathResult("kimi", json, [project]);
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
    case "copilot": {
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
