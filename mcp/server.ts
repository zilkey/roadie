/**
 * MCP server entry. `npm run mcp` = Streamable HTTP on :3300 (path /mcp, header "Authorization: Bearer <key>").
 * `npm run mcp:stdio` = stdio, key in the MCP_TOKEN environment variable. Both read/write whatever Firestore the
 * environment points at: the local emulator by default, or the real project when GOOGLE_APPLICATION_CREDENTIALS is set.
 */
import "./env";

async function main() {
  if (process.argv.includes("--stdio")) {
    const { runStdio } = await import("./stdio");
    await runStdio();
    return;
  }
  const { createHttpServer } = await import("./http");
  const port = Number(process.env.MCP_PORT ?? 3300);
  createHttpServer().listen(port, "127.0.0.1", () => console.error(`Band Tracker MCP listening on http://127.0.0.1:${port}/mcp`));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
