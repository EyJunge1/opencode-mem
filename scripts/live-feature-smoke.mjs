/**
 * End-to-end live smoke for Turso engine migration, schema migrations,
 * encryption-at-rest, vector search, ready gate.
 * Run: bun scripts/live-feature-smoke.mjs
 */
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { connect } from "@tursodatabase/database";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { platform, tmpdir } from "node:os";

const root = join(import.meta.dirname, "..");

// Load compiled-from-source via Bun TS transpile of the package entry points.
const { CONFIG } = await import(join(root, "src/config.ts"));
const { resetTursoReady, ensureTursoReady } = await import(
  join(root, "src/services/turso/ready.ts")
);
const { tursoShardManager } = await import(join(root, "src/services/turso/shard-manager.ts"));
const { tursoConnectionManager } = await import(
  join(root, "src/services/turso/connection-manager.ts")
);
const { tursoVectorSearch } = await import(join(root, "src/services/turso/vector-search.ts"));
const { runTursoEngineMigration } = await import(
  join(root, "src/services/turso/engine-migrator.ts")
);
const { runDatabaseEncryptionMigration } = await import(
  join(root, "src/services/turso/encryption-migrator.ts")
);
const {
  generateDatabaseEncryptionKeyFile,
  isValidDatabaseEncryptionHexKey,
  resolveOrCreateDatabaseEncryptionKey,
} = await import(join(root, "src/services/turso/encryption-key.ts"));
const { applySchemaMigrations, USER_PROMPTS_MIGRATIONS, ensureUserPromptColumns } = await import(
  join(root, "src/services/turso/schema-migrations.ts")
);
const { TursoDb } = await import(join(root, "src/services/turso/turso-db.ts"));

const SCOPE = "a1b2c3d4e5f67890";
const baseDir = mkdtempSync(join(tmpdir(), "opencode-mem-live-"));
const previous = {
  storagePath: CONFIG.storagePath,
  embeddingDimensions: CONFIG.embeddingDimensions,
  databaseEncryptionEnabled: CONFIG.databaseEncryptionEnabled,
  databaseEncryptionKey: CONFIG.databaseEncryptionKey,
};

function restoreConfig() {
  CONFIG.storagePath = previous.storagePath;
  CONFIG.embeddingDimensions = previous.embeddingDimensions;
  CONFIG.databaseEncryptionEnabled = previous.databaseEncryptionEnabled;
  CONFIG.databaseEncryptionKey = previous.databaseEncryptionKey;
}

async function cleanup() {
  try {
    await tursoConnectionManager.closeAll();
  } catch {
    // ignore
  }
  resetTursoReady();
  restoreConfig();
  rmSync(baseDir, { recursive: true, force: true });
}

function log(step, detail = "") {
  console.log(`✔ ${step}${detail ? ` — ${detail}` : ""}`);
}

try {
  CONFIG.storagePath = baseDir;
  CONFIG.embeddingDimensions = 768;
  CONFIG.databaseEncryptionEnabled = false;
  CONFIG.databaseEncryptionKey = undefined;
  mkdirSync(join(baseDir, "projects"), { recursive: true });
  mkdirSync(join(baseDir, "config"), { recursive: true });

  const dims = CONFIG.embeddingDimensions;
  const contentVec = () => {
    const v = new Float32Array(dims);
    v[0] = 1;
    return v;
  };
  const tagsVec = () => {
    const v = new Float32Array(dims);
    v[1] = 1;
    return v;
  };

  // --- 1) Schema migrations on aux DB ---
  {
    const dbPath = join(baseDir, "user-prompts.db");
    const native = await connect(dbPath, { experimental: ["encryption"] });
    const db = new TursoDb(native);
    const version = await applySchemaMigrations(db, USER_PROMPTS_MIGRATIONS, {
      dbPath,
      label: "live-user-prompts",
    });
    assert.equal(version, 1);
    await ensureUserPromptColumns(db);
    const again = await applySchemaMigrations(db, USER_PROMPTS_MIGRATIONS, {
      dbPath,
      label: "live-user-prompts",
    });
    assert.equal(again, 1);
    await db.close();
    log("schema migrations", "user_version=1 idempotent");
  }

  // --- 2) Native tursodb shard + exact cosine search ---
  {
    resetTursoReady();
    await ensureTursoReady();
    const shard = await tursoShardManager.createShard("project", SCOPE, 0);
    const db = await tursoConnectionManager.getConnection(shard.dbPath);
    await tursoVectorSearch.insertVector(db, {
      id: "mem_live_1",
      content: "live smoke memory",
      vector: contentVec(),
      tagsVector: tagsVec(),
      containerTag: `opencode_project_${SCOPE}`,
      tags: "live,smoke",
      type: "project",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: JSON.stringify({ live: true }),
      displayName: "Live Memory",
      projectPath: "/live/project",
    });
    await tursoShardManager.incrementVectorCount(shard.id);

    const hits = await tursoVectorSearch.searchInShard(
      shard,
      contentVec(),
      `opencode_project_${SCOPE}`,
      5,
      "live"
    );
    assert.ok(hits.length >= 1, "vector search must return inserted memory");
    assert.equal(hits[0]?.id, "mem_live_1");
    log("vector search", `${hits.length} hit(s) on tursodb shard`);
  }

  // --- 3) Engine migration: libSQL DiskANN-style shard → tursodb ---
  {
    const projectsDir = join(baseDir, "projects");
    const legacyPath = join(projectsDir, `project_${SCOPE}_shard_1.db`);
    // Build a libsql DB with a vector index expression that triggers rewrite detection.
    const client = createClient({ url: `file:${legacyPath}` });
    try {
      await client.execute(`
        CREATE TABLE memories (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          vector F32_BLOB(768) NOT NULL,
          tags_vector F32_BLOB(768),
          container_tag TEXT NOT NULL,
          tags TEXT,
          type TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          metadata TEXT,
          display_name TEXT,
          user_name TEXT,
          user_email TEXT,
          project_path TEXT,
          project_name TEXT,
          git_repo_url TEXT,
          is_pinned INTEGER DEFAULT 0
        )
      `);
      const engineVec = new Array(768).fill(0);
      engineVec[1] = 1;
      await client.execute({
        sql: `INSERT INTO memories (id, content, vector, container_tag, created_at, updated_at)
              VALUES (?, ?, vector32(?), ?, ?, ?)`,
        args: [
          "mem_engine_1",
          "engine migrate me",
          JSON.stringify(engineVec),
          `opencode_project_${SCOPE}`,
          Date.now(),
          Date.now(),
        ],
      });
      // DiskANN-style index (libsql). If unsupported, still leave a marker sql that matches detector.
      try {
        await client.execute(
          `CREATE INDEX memories_vector_idx ON memories (libsql_vector_idx(vector))`
        );
      } catch {
        // Some libsql builds reject DiskANN; force rewrite via raw sqlite_master isn't possible.
        // Fall through: if open with tursodb works, engine migration is a no-op — still validate marker path.
      }
    } finally {
      client.close();
    }

    // Clear engine marker so migrator runs.
    const engineMarker = join(baseDir, ".tursodb-engine-v1");
    if (existsSync(engineMarker)) rmSync(engineMarker);

    await tursoConnectionManager.closeAll();
    resetTursoReady();
    await runTursoEngineMigration();
    assert.ok(existsSync(engineMarker), "engine migration marker must be written");

    // Re-open via connection manager and confirm row readable.
    const db = await tursoConnectionManager.getConnection(legacyPath);
    const row = await db.get(`SELECT id, content FROM memories WHERE id = ?`, ["mem_engine_1"]);
    assert.equal(row?.id, "mem_engine_1");
    assert.equal(row?.content, "engine migrate me");
    log("engine migration", "libsql shard readable via @tursodatabase/database");
  }

  // --- 4) Encryption key auto-gen + encrypt migration ---
  {
    const keyPath = join(baseDir, "config", "opencode-mem-db.key");
    CONFIG.databaseEncryptionEnabled = true;
    CONFIG.databaseEncryptionKey = `file://${keyPath}`;

    const hex = resolveOrCreateDatabaseEncryptionKey();
    assert.ok(isValidDatabaseEncryptionHexKey(hex));
    assert.equal(hex.length, 64);
    assert.ok(existsSync(keyPath));
    if (platform() !== "win32") {
      assert.equal(statSync(keyPath).mode & 0o777, 0o600);
    }
    log("encryption key", `auto-generated 0600 at ${keyPath}`);

    await tursoConnectionManager.closeAll();
    const encryptMarker = join(baseDir, ".tursodb-encrypted-v1");
    if (existsSync(encryptMarker)) rmSync(encryptMarker);

    await runDatabaseEncryptionMigration();
    assert.ok(existsSync(encryptMarker), "encryption marker must exist");

    // Plaintext open must fail; encrypted open must succeed.
    const anyDb = readdirSync(join(baseDir, "projects")).find(
      (n) => n.endsWith(".db") && !n.includes(".bak") && !n.includes(".tmp")
    );
    assert.ok(anyDb, "expected at least one project db");
    const dbPath = join(baseDir, "projects", anyDb);

    await assert.rejects(
      () => connect(dbPath, { experimental: ["encryption"] }),
      /./,
      "plaintext open of encrypted db must fail"
    );

    const enc = await connect(dbPath, {
      encryption: { cipher: "aes256gcm", hexkey: hex },
      experimental: ["encryption"],
    });
    await enc.prepare("SELECT 1").all();
    await enc.close();

    // Ready gate with encryption still on.
    resetTursoReady();
    await ensureTursoReady();
    const db = await tursoConnectionManager.getConnection(dbPath);
    await db.get("SELECT 1");
    log("encryption migration", "plaintext→encrypted + ready gate OK");
  }

  // --- 5) Refuse new key when encrypted marker exists ---
  {
    const badKey = join(baseDir, "config", "another.key");
    assert.throws(() => generateDatabaseEncryptionKeyFile(badKey), /already exist/);
    log("key refuse", "blocked when .tursodb-encrypted-v1 present");
  }

  console.log("\nLIVE FEATURE SMOKE PASSED");
  console.log(`storage: ${baseDir}`);
  console.log(`files: ${readdirSync(baseDir).join(", ")}`);
} catch (error) {
  console.error("\nLIVE FEATURE SMOKE FAILED");
  console.error(error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
