import { CONFIG, initConfig } from "../config.js";
import { findHealthyRuntimeBaseUrl } from "../mcp/runtime-client.js";
import { readRuntimeInfo } from "../services/runtime-info.js";
import { AUTH_HEADER, getOrCreateAuthToken } from "../services/auth-token.js";
import { detectInstalledIdes } from "./ide-detect.js";
import { isIdeConfigured, SUPPORTED_IDES, type InstallIde } from "./install.js";

export interface IdeCoverage {
  ide: InstallIde;
  detected: boolean;
  configured: boolean;
}

export interface StatusReport {
  directory: string;
  configuredPort: number;
  configuredHost: string;
  runtimeFile: ReturnType<typeof readRuntimeInfo>;
  healthyUrl: string | null;
  health?: {
    success?: boolean;
    status?: string;
    service?: string;
    pid?: number;
  };
  agents: IdeCoverage[];
  advice: string[];
}

export async function collectStatus(directory = process.cwd()): Promise<StatusReport> {
  initConfig(directory);
  const configuredHost = CONFIG.webServerHost || "127.0.0.1";
  const configuredPort = CONFIG.webServerPort || 4747;
  const runtimeFile = readRuntimeInfo();
  const healthyUrl = await findHealthyRuntimeBaseUrl(configuredHost, configuredPort);

  let health: StatusReport["health"];
  if (healthyUrl) {
    try {
      const res = await fetch(`${healthyUrl}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      health = (await res.json()) as StatusReport["health"];
    } catch {
      health = undefined;
    }
  }

  const detected = new Set(detectInstalledIdes());
  const agents: IdeCoverage[] = SUPPORTED_IDES.map((ide) => ({
    ide,
    detected: detected.has(ide),
    configured: isIdeConfigured(ide),
  }));

  const advice: string[] = [];
  if (!healthyUrl) {
    advice.push("No healthy runtime found. Start one with: opencode-mem serve");
    advice.push(
      "MCP hosts auto-start serve on first tool call, but starting it explicitly avoids cold-start latency."
    );
  } else {
    advice.push(
      `Shared runtime is up at ${healthyUrl} — point all agents at the same store (single owner).`
    );
    advice.push(
      "Auth token for /api/* lives at ~/.opencode-mem/.auth-token (MCP sends it automatically)."
    );
  }

  const missing = agents.filter((a) => a.detected && !a.configured);
  if (missing.length > 0) {
    advice.push(
      `Detected but not configured: ${missing.map((m) => m.ide).join(", ")} — run: opencode-mem install --ide auto --cwd "$PWD"`
    );
  } else if (agents.some((a) => a.configured)) {
    advice.push("Configured agent MCP/plugin entries look present.");
  } else {
    advice.push('No agent configs found yet. Run: opencode-mem install --ide auto --cwd "$PWD"');
  }

  // Touch token creation so first MCP call does not race token file creation.
  try {
    getOrCreateAuthToken();
  } catch {
    // ignore
  }

  return {
    directory,
    configuredPort,
    configuredHost,
    runtimeFile,
    healthyUrl,
    health,
    agents,
    advice,
  };
}

export async function printStatus(directory = process.cwd()): Promise<void> {
  const report = await collectStatus(directory);
  console.log(`opencode-mem status`);
  console.log(`  cwd:            ${report.directory}`);
  console.log(`  configured:     ${report.configuredHost}:${report.configuredPort}`);
  console.log(
    `  runtime.json:   ${
      report.runtimeFile ? `${report.runtimeFile.url} (pid ${report.runtimeFile.pid})` : "(missing)"
    }`
  );
  console.log(`  healthy:        ${report.healthyUrl ?? "(none)"}`);
  if (report.health) {
    console.log(
      `  health:         service=${report.health.service ?? "?"} status=${report.health.status ?? "?"} pid=${report.health.pid ?? "?"}`
    );
  }
  console.log(`  auth header:    ${AUTH_HEADER}`);
  console.log(`agents:`);
  for (const agent of report.agents) {
    if (!agent.detected && !agent.configured) continue;
    const flags = [
      agent.detected ? "detected" : null,
      agent.configured ? "configured" : "missing-config",
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`  - ${agent.ide}: ${flags}`);
  }
  if (report.agents.every((a) => !a.detected && !a.configured)) {
    console.log(`  (none detected or configured)`);
  }
  console.log(`advice:`);
  for (const line of report.advice) {
    console.log(`  - ${line}`);
  }
}
