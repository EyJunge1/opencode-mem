import type { InstallIde } from "./catalog.js";

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
