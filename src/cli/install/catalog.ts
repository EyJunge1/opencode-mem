/**
 * CLI-facing install catalog — re-exports shared host IDs and adds parseIdeList.
 */

import { detectInstalledIdes } from "./detect.js";
import {
  HOST_IDS,
  IDE_ALIASES,
  IDE_NEXT_STEPS,
  INSTALL_HOST_PLATFORM_SOURCES,
  SUPPORTED_IDES,
  type HostId,
} from "../../shared/hosts.js";

export type InstallIde = HostId;
export { HOST_IDS, IDE_ALIASES, IDE_NEXT_STEPS, INSTALL_HOST_PLATFORM_SOURCES, SUPPORTED_IDES };

export function resolveIdeAlias(raw: string): string {
  return IDE_ALIASES[raw] ?? raw;
}

export function parseIdeList(raw: string | undefined): InstallIde[] {
  if (!raw || !raw.trim()) {
    throw new Error(
      `Missing --host / --ide. Use one of: ${SUPPORTED_IDES.join(", ")}, all, or auto`
    );
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "all") return [...SUPPORTED_IDES];
  if (normalized === "auto") {
    const detected = detectInstalledIdes();
    if (detected.length === 0) {
      throw new Error(
        "No coding-agent hosts detected under your home directory. Pass --host / --ide explicitly."
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
      throw new Error(`Use --host / --ide ${part} alone, not mixed with other values`);
    }
    const aliased = resolveIdeAlias(part);
    if (!SUPPORTED_IDES.includes(aliased as InstallIde)) {
      throw new Error(`Unknown host "${part}". Supported: ${SUPPORTED_IDES.join(", ")}, all, auto`);
    }
    if (!out.includes(aliased as InstallIde)) out.push(aliased as InstallIde);
  }
  return out;
}
