import { spawn, type ChildProcess } from "node:child_process";
import { AUTH_HEADER, getOrCreateAuthToken } from "../services/auth-token.js";
import { CONFIG, initConfig } from "../config.js";
import { readRuntimeInfo } from "../services/runtime-info.js";
import { log } from "../services/logger.js";

const HEALTH_TIMEOUT_MS = 800;
const START_WAIT_MS = 45_000;
const START_POLL_MS = 400;

export interface McpRuntimeClient {
  baseUrl: string;
  directory: string;
  search(args: {
    query: string;
    limit?: number;
    scope?: "project" | "all-projects";
  }): Promise<object>;
  timeline(args: { limit?: number; scope?: "project" | "all-projects" }): Promise<object>;
  get(ids: string[]): Promise<object>;
  write(args: {
    action: "add" | "forget" | "profile";
    content?: string;
    tags?: string;
    type?: string;
    memoryId?: string;
    platformSource?: string;
  }): Promise<object>;
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    [AUTH_HEADER]: getOrCreateAuthToken(),
  };
}

async function probeHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as {
      success?: boolean;
      status?: string;
      service?: string;
    };
    // Prefer the explicit service marker; older runtimes without it still match
    // success+status so OpenCode-owned web servers remain discoverable.
    if (body?.service && body.service !== "opencode-mem") return false;
    return body?.success === true && body?.status === "ok";
  } catch {
    return false;
  }
}

export async function findHealthyRuntimeBaseUrl(
  host = CONFIG.webServerHost || "127.0.0.1",
  basePort = CONFIG.webServerPort || 4747
): Promise<string | null> {
  const runtime = readRuntimeInfo();
  if (runtime?.url && (await probeHealth(runtime.url))) {
    return runtime.url.replace(/\/$/, "");
  }

  const loopbackHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  for (let port = basePort; port <= basePort + 10; port++) {
    const url = `http://${loopbackHost}:${port}`;
    if (await probeHealth(url)) return url;
  }
  return null;
}

function resolveServeCommand(directory: string): { command: string; args: string[] } {
  const entry = process.argv[1];
  if (entry) {
    return { command: process.execPath, args: [entry, "serve", "--cwd", directory] };
  }
  return { command: "opencode-mem", args: ["serve", "--cwd", directory] };
}

async function startServeChild(directory: string): Promise<ChildProcess> {
  const { command, args } = resolveServeCommand(directory);
  log("MCP auto-starting standalone serve", { command, args, directory });
  const child = spawn(command, args, {
    cwd: directory,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      OPENCODE_MEM_DIRECTORY: directory,
    },
  });
  child.unref();
  return child;
}

async function waitForHealthyRuntime(directory: string): Promise<string> {
  const deadline = Date.now() + START_WAIT_MS;
  while (Date.now() < deadline) {
    const url = await findHealthyRuntimeBaseUrl();
    if (url) return url;
    await new Promise((r) => setTimeout(r, START_POLL_MS));
  }
  throw new Error(
    `Timed out waiting for opencode-mem serve to become healthy (cwd=${directory}). ` +
      `Try running \`opencode-mem serve\` manually.`
  );
}

export async function ensureMcpRuntimeClient(directory = process.cwd()): Promise<McpRuntimeClient> {
  initConfig(directory);

  let baseUrl = await findHealthyRuntimeBaseUrl();
  if (!baseUrl) {
    await startServeChild(directory);
    baseUrl = await waitForHealthyRuntime(directory);
  }

  const client: McpRuntimeClient = {
    baseUrl,
    directory,
    async search(args) {
      const res = await fetch(`${baseUrl}/api/mcp/search`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ ...args, cwd: directory }),
      });
      return (await res.json()) as object;
    },
    async timeline(args) {
      const res = await fetch(`${baseUrl}/api/mcp/timeline`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ ...args, cwd: directory }),
      });
      return (await res.json()) as object;
    },
    async get(ids) {
      const res = await fetch(`${baseUrl}/api/mcp/get`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ ids, cwd: directory }),
      });
      return (await res.json()) as object;
    },
    async write(args) {
      const res = await fetch(`${baseUrl}/api/mcp/write`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          ...args,
          cwd: directory,
          platformSource: args.platformSource ?? process.env.OPENCODE_MEM_PLATFORM ?? "mcp",
        }),
      });
      return (await res.json()) as object;
    },
  };

  return client;
}
