/** OAuth authorization-server metadata (RFC 8414) for the MCP sign-in. See mcp/oauth.ts. */
import { authorizationServerMetadata, preflight } from "../../../../mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = authorizationServerMetadata;
export const OPTIONS = preflight;
