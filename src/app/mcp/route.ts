/** The Roadie MCP server, served by the app itself: APP_URL/mcp. Everything is in mcp/web.ts. */
import { handleMcpRequest } from "../../../mcp/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
