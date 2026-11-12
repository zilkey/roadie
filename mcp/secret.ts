/**
 * Production must set MCP_SESSION_SECRET (an App Hosting secret) so every instance signs the same way: it signs MCP
 * session ids (mcp/web.ts) and seals OAuth codes and client ids (mcp/oauth.ts). Dev and tests run one process against
 * the emulators and get a random one.
 */
import { randomBytes } from "node:crypto";

let fallbackSecret: string | undefined;
export function sessionSecret(): string {
  if (process.env.MCP_SESSION_SECRET) return process.env.MCP_SESSION_SECRET;
  const realProject = !!process.env.GCLOUD_PROJECT && !process.env.GCLOUD_PROJECT.startsWith("demo-");
  if (realProject) throw new Error("MCP_SESSION_SECRET is not set: MCP sessions can't be signed. Add it as an App Hosting secret (docs/MCP.md).");
  return (fallbackSecret ??= randomBytes(32).toString("base64url"));
}
