import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "../config.js";
import { log } from "./logger.js";

const LOCK_FILE = "dreaming.lock";
/** Treat locks older than this as stale (crashed process). */
const STALE_MS = 2 * 60 * 60 * 1000;

interface LockPayload {
  pid: number;
  acquiredAt: number;
}

function lockPath(): string {
  return join(CONFIG.storagePath, LOCK_FILE);
}

function readLock(): LockPayload | null {
  try {
    const raw = JSON.parse(readFileSync(lockPath(), "utf-8")) as LockPayload;
    if (typeof raw.pid !== "number" || typeof raw.acquiredAt !== "number") return null;
    return raw;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Exclusive cross-process lock for dreaming runs.
 * Returns a release function, or null if another live owner holds the lock.
 */
export function tryAcquireDreamingLock(): (() => void) | null {
  const dir = CONFIG.storagePath;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = lockPath();
  const payload: LockPayload = { pid: process.pid, acquiredAt: Date.now() };

  const existing = existsSync(path) ? readLock() : null;
  if (existing) {
    const stale = Date.now() - existing.acquiredAt > STALE_MS;
    const alive = isProcessAlive(existing.pid);
    // Same pid still counts as held (in-process re-entry must fail too).
    if (!stale && alive) {
      log("dreaming lock: held by another owner", {
        pid: existing.pid,
        acquiredAt: existing.acquiredAt,
      });
      return null;
    }
    try {
      unlinkSync(path);
    } catch {
      // race: another process may have removed it
    }
  }

  try {
    // wx: fail if recreated between unlink and create
    writeFileSync(path, JSON.stringify(payload), { flag: "wx" });
  } catch {
    log("dreaming lock: lost create race");
    return null;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      const current = readLock();
      if (current?.pid === process.pid) unlinkSync(path);
    } catch {
      // ignore
    }
  };
}
