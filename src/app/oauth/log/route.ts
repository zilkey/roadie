/** /connect's report of a step that stalled in the browser, written to the server log. See mcp/oauth.ts. */
import { connectLog } from "../../../../mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = connectLog;
