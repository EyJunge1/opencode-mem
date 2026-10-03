# Multi-host MCP setup

opencode-mem wires common coding-agent **hosts** (Cursor, Claude, Codex, …) via MCP + one shared local runtime.

Related: [Issue #366](https://github.com/tickernelz/opencode-mem/issues/366).

> Naming: **host** = Cursor / Claude / … (this doc). OpenCode **session agents** (build, orchestrator, …) and the internal structured-output agent are separate concepts.

## Quick start

```bash
# Detect every installed host and write MCP (or OpenCode plugin) configs
npx -y opencode-mem install --ide auto --cwd "$PWD"

# Or install every supported harness
npx -y opencode-mem install --ide all --cwd "$PWD"

# One shared runtime for all hosts
npx -y opencode-mem serve --cwd "$PWD"
npx -y opencode-mem status
```

Restart IDEs after install. `status` shows detected vs configured hosts. OpenCode attaches to a healthy `serve` when `preferSharedRuntime` is on (default).

With `--cwd`, install also writes **project-local** MCP configs (and pins `OPENCODE_MEM_DIRECTORY` there only). User-global configs stay multi-project safe (no baked directory).

## Supported hosts

| IDE / `--ide` | Config written                                                                            | `OPENCODE_MEM_PLATFORM` |
| ------------- | ----------------------------------------------------------------------------------------- | ----------------------- |
| `cursor`      | `~/.cursor/mcp.json` (+ project `.cursor/mcp.json`)                                       | `cursor`                |
| `claude`      | `~/.claude.json` (+ project `.mcp.json`)                                                  | `claude`                |
| `codex`       | `~/.codex/config.toml` (+ project `.codex/config.toml`)                                   | `codex`                 |
| `gemini`      | `~/.gemini/settings.json` (+ project `.gemini/settings.json`)                             | `gemini`                |
| `antigravity` | `~/.gemini/config/mcp_config.json` (+ project `.agents/mcp_config.json`)                  | `antigravity`           |
| `opencode`    | `~/.config/opencode/opencode.json` **plugin + MCP** (+ project `opencode.json`)           | `opencode`              |
| `windsurf`    | `~/.codeium/windsurf/mcp_config.json`                                                     | `windsurf`              |
| `kimi`        | `~/.kimi-code/mcp.json` (+ project `.kimi-code/mcp.json`)                                 | `kimi`                  |
| `openclaw`    | `~/.openclaw/openclaw.json` → `mcp.servers`                                               | `openclaw`              |
| `goose`       | `~/.config/goose/config.yaml` extension (`envs:`)                                         | `goose`                 |
| `warp`        | `~/.warp/.mcp.json` (+ project `.warp/.mcp.json`)                                         | `warp`                  |
| `copilot`     | VS Code User `mcp.json` (`servers`) + `~/.copilot/mcp-config.json` (+ `.vscode/mcp.json`) | `copilot`               |
| `grok`        | `~/.grok/config.toml` (+ project `.grok/config.toml`)                                     | `grok`                  |
| `all`         | every row above                                                                           | per-ide                 |
| `auto`        | only detected installs                                                                    | per-ide                 |

Aliases: `claude-code`→`claude`, `codex-cli`→`codex`, `antigravity-cli`→`antigravity`, `github-copilot`→`copilot`.

## Architecture

```text
Cursor / Claude / Codex / Gemini / Windsurf / Kimi / …
  → MCP stdio (`opencode-mem mcp`)
    → shared serve (HTTP)
      → Turso + embeddings + Web UI

OpenCode plugin + MCP
  → preferSharedRuntime? attach to serve : in-process
  → MCP tools: memory_timeline / memory_search / memory_get / memory_write
```

### Progressive tools (token-aware)

| Tool              | Role                                                       |
| ----------------- | ---------------------------------------------------------- |
| `memory_timeline` | Recent memories chronologically (session-start continuity) |
| `memory_search`   | Compact topical index (+ `platformSource`)                 |
| `memory_get`      | Full content for selected ids                              |
| `memory_write`    | add / forget / profile                                     |

Workflow: `memory_timeline` or `memory_search` → pick ids → `memory_get` (batch).

### Session priming (project `--cwd`)

For hosts without OpenCode-depth hooks, `install --cwd` also writes lightweight priming so the agent knows to call MCP at session start:

| Host                 | Priming file                                     |
| -------------------- | ------------------------------------------------ |
| Cursor               | `.cursor/rules/opencode-mem.mdc` (`alwaysApply`) |
| Claude               | `CLAUDE.md` marked block                         |
| Windsurf             | `.windsurf/rules/opencode-mem.md`                |
| Gemini / Antigravity | `GEMINI.md` marked block                         |
| Kimi                 | `.kimi-code/rules/opencode-mem.md`               |

OpenCode keeps native auto-capture / compaction inject — no priming file needed.

## Commands

```bash
opencode-mem serve [--host HOST] [--port PORT] [--cwd DIR]
opencode-mem mcp [--cwd DIR]
opencode-mem install --ide <ide[,ide]|all|auto> [--cwd DIR]
opencode-mem status [--cwd DIR]
```

## Env overrides

| Env                                  | Purpose                                        |
| ------------------------------------ | ---------------------------------------------- |
| `OPENCODE_MEM_DIRECTORY`             | Project root for shards (project configs only) |
| `OPENCODE_MEM_PLATFORM`              | Provenance stamp (set per IDE by `install`)    |
| `OPENCODE_MEM_STORAGE_PATH`          | Override data directory                        |
| `OPENCODE_MEM_PREFER_SHARED_RUNTIME` | OpenCode attach vs in-process                  |

## Single-owner playbook

1. `opencode-mem serve --cwd "$PWD"`
2. `opencode-mem install --ide auto --cwd "$PWD"`
3. Open OpenCode → attaches to serve; other hosts via MCP → same serve
4. `opencode-mem status` → one healthy URL + host coverage

## Adding a host

New coding-agent hosts go through the existing install catalog — **not** through Turso, AI, or web-server special cases.

1. Add a `HostSpec` entry in [`src/shared/hosts.ts`](../src/shared/hosts.ts) (`HOST_IDS`, detect/config paths, optional priming, `configKind`).
2. Wire install under [`src/cli/install/`](../src/cli/install/):
   - reuse a format in `formats/` when possible (`json`, `toml`, …), or add a small adapter under `hosts/` for one-off layouts;
   - `installIde()` already dispatches on `spec.configKind`.
3. Optional project priming via `priming` on the host spec + `install/priming.ts`.
4. Cover detection/config in `tests/install-ide.test.ts` (and status coverage if needed).

Do **not** put host detection, MCP config writers, or `platformSource` labels under `services/` storage/AI modules.

## Notes

- This is **MCP-first** multi-host wiring (faster + cheaper to maintain than native hooks per host).
- Progressive recall mirrors claude-mem-style disclosure (`timeline`/`search` → `get`); capture outside OpenCode stays host-initiated (`memory_write`) plus project priming rules.
- OpenCode keeps deep auto-capture / compaction / profile learning; when attached, capture **writes** go through the shared runtime.
- Auth: `~/.opencode-mem/.auth-token`. Runtime pointer: `~/.opencode-mem/runtime.json`.
