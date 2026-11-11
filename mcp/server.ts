/**
 * stdio MCP entry (`npm run mcp:stdio`): Claude Code starts this process itself, key in the MCP_TOKEN environment
 * variable. It reads/writes whatever Firestore the environment points at: the local emulator by default, or the real
 * project when GOOGLE_APPLICATION_CREDENTIALS is set. The HTTP endpoint is served by the app at /mcp (mcp/web.ts).
 */
import "./env";

async function main() {
  const { runStdio } = await import("./stdio");
  await runStdio();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
