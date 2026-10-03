/**
 * Compatibility shim — prefer `./memory-tool/index.js` for new imports.
 * Public API unchanged for existing plugin / web / MCP callers.
 */
export {
  MCP_SEARCH_DEFAULT_LIMIT,
  MCP_SNIPPET_MAX_CHARS,
  MCP_TIMELINE_DEFAULT_LIMIT,
  executeMemoryTool,
  formatSearchResults,
  mcpGetMemories,
  mcpSearchMemories,
  mcpTimelineMemories,
  mcpWriteMemory,
  type MemoryToolArgs,
  type MemoryToolContext,
  type MemoryToolMode,
} from "./memory-tool/index.js";
