import { headers } from "next/headers";
import { isLocalRequest } from "@/lib/localhost";
import { DevelopersGuide, UsersGuide } from "./guides";
import { McpTabs } from "./tabs";

/**
 * Server Component so the localhost check runs on the server: on any other host the Developers tab is never
 * rendered, so none of its content reaches the HTML or the RSC payload.
 */
export default async function McpPage() {
  const local = isLocalRequest(await headers());
  return <McpTabs users={<UsersGuide connectorUrl={connectorUrl()} />} developers={local ? <DevelopersGuide /> : undefined} />;
}

/** Public MCP address for users: MCP_URL if set, otherwise APP_URL + /mcp. */
function connectorUrl() {
  if (process.env.MCP_URL) return process.env.MCP_URL;
  return `${(process.env.APP_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "")}/mcp`;
}
