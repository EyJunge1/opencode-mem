import type { McpRuntimeClient } from "../mcp/runtime-client.js";

/**
 * When OpenCode attaches to a healthy shared `serve` process, tools and
 * auto-capture writes go through this bridge instead of opening a second
 * Turso/embedding owner in-process.
 */
let sharedBridge: McpRuntimeClient | null = null;
let sharedBaseUrl: string | null = null;

export function setSharedRuntimeBridge(
  client: McpRuntimeClient | null,
  baseUrl: string | null = null
): void {
  sharedBridge = client;
  sharedBaseUrl = client ? (baseUrl ?? client.baseUrl) : null;
}

export function getSharedRuntimeBridge(): McpRuntimeClient | null {
  return sharedBridge;
}

export function getSharedRuntimeBaseUrl(): string | null {
  return sharedBaseUrl;
}

export function isUsingSharedRuntime(): boolean {
  return sharedBridge !== null;
}
