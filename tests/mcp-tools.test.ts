import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import type { McpRuntimeClient } from "../src/mcp/runtime-client.js";

describe("MCP server progressive tools", () => {
  it("exposes search → get progressive disclosure tools", async () => {
    const calls: string[] = [];
    const fakeClient: McpRuntimeClient = {
      baseUrl: "http://127.0.0.1:9",
      directory: "/tmp",
      search: async (args) => {
        calls.push(`search:${args.query}`);
        return {
          success: true,
          results: [{ id: "1", score: 88, snippet: "hi" }],
          hint: "Call memory_get with promising ids to fetch full content.",
        };
      },
      get: async (ids) => {
        calls.push(`get:${ids.join(",")}`);
        return { success: true, memories: [{ id: ids[0], content: "full" }] };
      },
      write: async (args) => {
        calls.push(`write:${args.action}`);
        return { success: true, message: "ok" };
      },
    };

    const { server } = await createMcpServer("/tmp", fakeClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const listed = await client.listTools();
      const names = listed.tools.map((t) => t.name).sort();
      expect(names).toEqual(["memory_get", "memory_search", "memory_write"]);

      const search = await client.callTool({
        name: "memory_search",
        arguments: { query: "auth" },
      });
      expect(JSON.stringify(search)).toContain("memory_get");
      expect(calls).toContain("search:auth");

      const get = await client.callTool({
        name: "memory_get",
        arguments: { ids: ["1"] },
      });
      expect(JSON.stringify(get)).toContain("full");
      expect(calls).toContain("get:1");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
