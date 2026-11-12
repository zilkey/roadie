/** /connect's call: list your artists, or approve one and get the redirect back to Claude. See mcp/oauth.ts. */
import { approve } from "../../../../mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = approve;
