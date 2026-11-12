/** Dynamic client registration (RFC 7591) for the MCP sign-in. See mcp/oauth.ts. */
import { preflight, register } from "../../../../mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = register;
export const OPTIONS = preflight;
