import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { authenticateToken, mcpCtx } from "./auth";
import { createMcpServer } from "./tools";
import { newRunId } from "@/server/ctx";

/** Key comes from MCP_TOKEN. One process = one session = one runId. */
export async function runStdio() {
  const raw = process.env.MCP_TOKEN;
  await authenticateToken(raw); // fail fast with a clear message
  const runId = newRunId();
  const server = createMcpServer(async () => mcpCtx(await authenticateToken(raw), runId));
  await server.connect(new StdioServerTransport());
}
