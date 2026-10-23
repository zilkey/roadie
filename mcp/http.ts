/** Streamable HTTP transport on port 3300. One session = one runId; every request must carry the same valid bearer token. */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { authenticateToken, bearerOf, mcpCtx, type McpIdentity } from "./auth";
import { createMcpServer } from "./tools";
import { newRunId } from "@/server/ctx";
import { AppError } from "@/server/errors";

interface Session { transport: StreamableHTTPServerTransport; tokenHash: string; runId: string }

const send = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
};
const rpcError = (res: http.ServerResponse, status: number, message: string) =>
  send(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null });

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

export function createHttpServer() {
  const sessions = new Map<string, Session>();

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/health") return send(res, 200, { ok: true, sessions: sessions.size });
      if (url.pathname !== "/mcp") return send(res, 404, { error: "Not found. The MCP endpoint is /mcp" });

      let id: McpIdentity;
      const raw = bearerOf(req.headers.authorization);
      try { id = await authenticateToken(raw); }
      catch (e) {
        if (e instanceof AppError) { res.setHeader("WWW-Authenticate", "Bearer"); return send(res, e.status, e.toJSON()); }
        throw e;
      }

      const sid = req.headers["mcp-session-id"] as string | undefined;
      const body = req.method === "POST" ? await readBody(req) : undefined;

      if (sid) {
        const s = sessions.get(sid);
        if (!s) return rpcError(res, 404, "Unknown session. Initialize again.");
        if (s.tokenHash !== id.tokenHash) return send(res, 403, { error: { code: "forbidden", message: "Session belongs to another token" } });
        return await s.transport.handleRequest(req, res, body);
      }
      if (req.method !== "POST" || !isInitializeRequest(body)) return rpcError(res, 400, "Send an initialize request first");

      const runId = newRunId();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (s) => { sessions.set(s, { transport, tokenHash: id.tokenHash, runId }); },
      });
      transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
      // Re-check the token on every tool call so revoking a key takes effect inside a running session.
      const server = createMcpServer(async () => {
        const again = await authenticateToken(raw);
        return mcpCtx(again, runId);
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: { code: "internal", message: "Something went wrong" } });
    }
  });
}
