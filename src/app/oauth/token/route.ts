/** The MCP token endpoint: code (+ PKCE) or refresh token in, Roadie key out as the bearer. See mcp/oauth.ts. */
import { preflight, token } from "../../../../mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = token;
export const OPTIONS = preflight;
