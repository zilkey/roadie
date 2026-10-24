/**
 * The MCP endpoint as one Web-standard `Request -> Response` function, so Next can serve it in-process at /mcp (see
 * src/app/mcp/route.ts) and tests can call it without a socket.
 *
 * Stateless by design: App Hosting runs up to two instances and scales to zero, so nothing may live in process memory
 * between requests. Every request gets a fresh transport and server, the bearer token is re-checked every time (a
 * revoked key stops working at once), and "one session = one runId" survives because the session id *is* the runId,
 * signed with MCP_SESSION_SECRET and bound to the token: `${runId}.${hmac(secret, runId:tokenHash)}`. The client echoes
 * it back in `Mcp-Session-Id`; a forged or foreign id fails the signature and gets 404, which tells the client to
 * initialize again.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { authenticateToken, bearerOf, mcpCtx } from "./auth";
import { createMcpServer } from "./tools";
import { newRunId } from "@/server/ctx";
import { AppError } from "@/server/errors";

export const SESSION_HEADER = "mcp-session-id";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const rpcError = (status: number, message: string) => json(status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null });

/**
 * Production must set MCP_SESSION_SECRET (an App Hosting secret) so every instance signs the same way. Dev and tests run
 * one process against the emulators and get a random one.
 */
let fallbackSecret: string | undefined;
function sessionSecret(): string {
  if (process.env.MCP_SESSION_SECRET) return process.env.MCP_SESSION_SECRET;
  const realProject = !!process.env.GCLOUD_PROJECT && !process.env.GCLOUD_PROJECT.startsWith("demo-");
  if (realProject) throw new Error("MCP_SESSION_SECRET is not set: MCP sessions can't be signed. Add it as an App Hosting secret (docs/MCP.md).");
  return (fallbackSecret ??= randomBytes(32).toString("base64url"));
}
const sign = (runId: string, tokenHash: string) => createHmac("sha256", sessionSecret()).update(`${runId}:${tokenHash}`).digest("base64url");
export const sessionIdFor = (runId: string, tokenHash: string) => `${runId}.${sign(runId, tokenHash)}`;
/** The runId a session id stands for, if it was issued to this token; otherwise undefined. */
export function runIdOf(sessionId: string, tokenHash: string): string | undefined {
  const dot = sessionId.lastIndexOf(".");
  if (dot < 1) return undefined;
  const runId = sessionId.slice(0, dot);
  const given = Buffer.from(sessionId.slice(dot + 1));
  const want = Buffer.from(sign(runId, tokenHash));
  return given.length === want.length && timingSafeEqual(given, want) ? runId : undefined;
}

export async function handleMcpRequest(req: Request): Promise<Response> {
  try {
    const raw = bearerOf(req.headers.get("authorization"));
    let id;
    try { id = await authenticateToken(raw); }
    catch (e) {
      if (e instanceof AppError) return json(e.status, e.toJSON(), { "WWW-Authenticate": "Bearer" });
      throw e;
    }

    let body: unknown;
    if (req.method === "POST") {
      try { body = await req.json(); }
      catch { return rpcError(400, "Body must be JSON"); }
    }

    const sid = req.headers.get(SESSION_HEADER);
    let runId: string;
    let issued: string | undefined;
    if (sid) {
      const found = runIdOf(sid, id.tokenHash);
      if (!found) return rpcError(404, "Unknown session. Initialize again.");
      runId = found;
    } else {
      if (req.method !== "POST" || !isInitializeRequest(body)) return rpcError(400, "Send an initialize request first");
      runId = newRunId();
      issued = sessionIdFor(runId, id.tokenHash);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createMcpServer(async () => mcpCtx(await authenticateToken(raw), runId));
    await server.connect(transport);
    const res = await transport.handleRequest(req, { parsedBody: body });
    if (!issued) return res;
    const headers = new Headers(res.headers);
    headers.set(SESSION_HEADER, issued);
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    console.error(e);
    return json(500, { error: { code: "internal", message: "Something went wrong" } });
  }
}
