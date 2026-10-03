/**
 * Memory tool surface shared by OpenCode plugin modes and MCP progressive APIs.
 *
 * Prefer importing from this barrel (`./memory-tool/index.js`) or the
 * compatibility shim `../memory-tool-service.js`.
 */

export {
  MCP_SEARCH_DEFAULT_LIMIT,
  MCP_SNIPPET_MAX_CHARS,
  MCP_TIMELINE_DEFAULT_LIMIT,
  formatSearchResults,
  snippetFromContent,
  type MemoryToolArgs,
  type MemoryToolContext,
  type MemoryToolMode,
} from "./types.js";

export { executeMemoryTool } from "./execute.js";

export {
  mcpGetMemories,
  mcpSearchMemories,
  mcpTimelineMemories,
  mcpWriteMemory,
} from "./mcp-api.js";
