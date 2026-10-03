import { CONFIG, initConfig } from "../config.js";
import { log } from "../services/logger.js";
import { ensureTursoReady } from "../services/turso/ready.js";
import { WebAuth } from "../services/web-auth.js";
import { startWebServer, type WebServer } from "../services/web-server.js";
import { clearRuntimeInfo, writeRuntimeInfo } from "../services/runtime-info.js";
import { memoryClient } from "../services/client.js";

export interface ServeOptions {
  directory?: string;
  host?: string;
  port?: number;
}

export async function runServe(options: ServeOptions = {}): Promise<WebServer> {
  const directory = options.directory ?? process.cwd();
  initConfig(directory);

  const host = options.host ?? CONFIG.webServerHost;
  const port = options.port ?? CONFIG.webServerPort;

  await ensureTursoReady();
  await memoryClient.warmup().catch((error) => {
    log("Standalone serve embedding warmup failed (continuing)", { error: String(error) });
  });

  const webAuth = new WebAuth({
    password: CONFIG.webServerAuthPassword,
    username: CONFIG.webServerAuthUsername,
  });

  const server = await startWebServer({
    port,
    host,
    enabled: true,
    auth: webAuth,
    apiToken: CONFIG.webServerApiToken,
  });

  const url = server.getUrl();
  const parsed = new URL(url);
  const hostForClients =
    parsed.hostname === "0.0.0.0" || parsed.hostname === "::" ? "127.0.0.1" : parsed.hostname;
  const listenPort = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  const clientUrl = `http://${hostForClients}:${listenPort}`;
  writeRuntimeInfo({
    host: hostForClients,
    port: listenPort,
    pid: process.pid,
    url: clientUrl,
    startedAt: Date.now(),
  });

  log("Standalone memory runtime started", { url: clientUrl, directory, pid: process.pid });
  console.error(`opencode-mem serve listening on ${clientUrl}`);

  const shutdown = async (signal: string) => {
    log("Standalone serve shutting down", { signal });
    clearRuntimeInfo(process.pid);
    try {
      await server.stop();
    } catch {
      // ignore
    }
    try {
      await memoryClient.close();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  return server;
}
