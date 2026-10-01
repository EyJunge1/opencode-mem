import { connect, type Database } from "@tursodatabase/database";
import type { DatabaseOpts, EncryptionOpts } from "@tursodatabase/database-common";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { CONFIG } from "../../config.js";
import { log } from "../logger.js";
import { collectReleasedSqliteHandles } from "./sqlite-handle-release.js";
import { TursoDb } from "./turso-db.js";
import { resolveOrCreateDatabaseEncryptionKey } from "./encryption-key.js";

export type ConnectFactory = (path: string, opts?: DatabaseOpts) => Promise<Database>;

function assertPathInsideStorage(dbPath: string): void {
  const storageRoot = resolve(CONFIG.storagePath);
  const resolvedPath = resolve(dbPath);
  const relativePath = relative(storageRoot, resolvedPath);
  // Only treat path-segment traversal as escape (not filenames containing "..").
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Refusing to open database outside storagePath: ${dbPath}`);
  }
}

function buildConnectOptions(encryption?: EncryptionOpts | null): DatabaseOpts {
  const opts: DatabaseOpts = {
    experimental: ["encryption"],
  };
  if (encryption) {
    opts.encryption = encryption;
  }
  return opts;
}

export function resolveDatabaseEncryption(): EncryptionOpts | null {
  const hexkey = resolveOrCreateDatabaseEncryptionKey();
  if (!hexkey) return null;
  return {
    cipher: CONFIG.databaseEncryptionCipher,
    hexkey,
  };
}

export class TursoConnectionManager {
  private readonly connections = new Map<string, TursoDb>();
  private readonly pending = new Map<string, Promise<TursoDb>>();
  private readonly closingConnections = new Map<string, Promise<void>>();
  private closingPromise: Promise<void> | null = null;

  constructor(private readonly connectFactory: ConnectFactory = connect) {}

  async getConnection(dbPath: string): Promise<TursoDb> {
    if (this.closingPromise) {
      await this.closingPromise;
    }
    const closingConnection = this.closingConnections.get(dbPath);
    if (closingConnection) {
      await closingConnection;
    }
    assertPathInsideStorage(dbPath);

    const existing = this.connections.get(dbPath);
    if (existing) {
      return existing;
    }

    const inFlight = this.pending.get(dbPath);
    if (inFlight) {
      return inFlight;
    }

    const openPromise = (async (): Promise<TursoDb> => {
      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const encryption = resolveDatabaseEncryption();
      const opts = buildConnectOptions(encryption);
      let database: Database | null = null;
      try {
        database = await this.connectFactory(dbPath, opts);
        const db = new TursoDb(database);
        await db.execute("PRAGMA foreign_keys = ON");
        this.connections.set(dbPath, db);
        return db;
      } catch (error) {
        if (database) {
          try {
            await database.close();
          } catch {
            // ignore close errors during cleanup
          }
        }
        if (encryption) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Failed to open encrypted database ${dbPath}: ${message}. ` +
              `Check databaseEncryptionKey / cipher, or remove encryption config for plaintext shards.`,
            { cause: error }
          );
        }
        throw error;
      }
    })();

    this.pending.set(dbPath, openPromise);

    try {
      return await openPromise;
    } catch (error) {
      this.connections.delete(dbPath);
      throw error;
    } finally {
      this.pending.delete(dbPath);
    }
  }

  async closeConnection(dbPath: string): Promise<void> {
    if (this.closingPromise) {
      await this.closingPromise;
    }
    const existingClose = this.closingConnections.get(dbPath);
    if (existingClose) {
      return existingClose;
    }

    const closePromise = Promise.resolve()
      .then(async () => {
        const pending = this.pending.get(dbPath);
        if (pending) {
          await Promise.allSettled([pending]);
        }

        const db = this.connections.get(dbPath);
        if (db) {
          try {
            await db.close();
          } catch (error) {
            log("Error closing Turso database", { path: dbPath, error: String(error) });
          }

          this.connections.delete(dbPath);
        }

        await collectReleasedSqliteHandles();
      })
      .finally(() => {
        this.closingConnections.delete(dbPath);
      });

    this.closingConnections.set(dbPath, closePromise);
    return closePromise;
  }

  async closeAll(): Promise<void> {
    if (this.closingPromise) return this.closingPromise;

    this.closingPromise = (async () => {
      await Promise.allSettled([...this.pending.values(), ...this.closingConnections.values()]);
      for (const [path, db] of this.connections) {
        try {
          await db.close();
        } catch (error) {
          log("Error closing Turso database", { path, error: String(error) });
        }
      }
      this.connections.clear();
      this.pending.clear();
      await collectReleasedSqliteHandles();
    })();

    try {
      await this.closingPromise;
    } finally {
      this.closingPromise = null;
    }
  }

  closeAllSync(): void {
    for (const [path, db] of this.connections) {
      try {
        void db.close();
      } catch (error) {
        log("Error closing Turso database (sync)", { path, error: String(error) });
      }
    }
    this.connections.clear();
    this.pending.clear();
  }
}

export const tursoConnectionManager = new TursoConnectionManager();
