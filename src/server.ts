import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { listDirectory } from "./tools/listDirectory.js";
import { readFile } from "./tools/readFile.js";

function createServer() {
  const server = new McpServer({
    name: "computer-mcp",
    version: "0.1.0",
  });

  server.tool(
    "list_directory",
    "List files and folders inside an explicitly allowed local directory. Read-only.",
    { path: z.string().describe("Absolute local directory path") },
    async ({ path }) => {
      try {
        const entries = await listDirectory(path);
        return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );

  server.tool(
    "read_file",
    "Read a UTF-8 text file inside an explicitly allowed local directory. Read-only; max 512 KiB.",
    { path: z.string().describe("Absolute local file path") },
    async ({ path }) => {
      try {
        const text = await readFile(path);
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

app.all("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session) {
      if (req.method !== "POST") {
        res.status(400).json({ error: "No valid MCP session." });
        return;
      }

      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, { transport, server }),
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      session = { transport, server };
    }

    await session.transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "computer-mcp", version: "0.1.0" });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, "127.0.0.1", () => {
  console.log(`computer-mcp listening on http://127.0.0.1:${port}/mcp`);
});
