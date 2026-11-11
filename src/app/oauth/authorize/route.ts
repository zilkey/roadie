/** The MCP sign-in page: paste your Roadie key, go back to Claude with a code. See mcp/oauth.ts. */
import { authorize } from "../../../../mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = authorize;
export const POST = authorize;
