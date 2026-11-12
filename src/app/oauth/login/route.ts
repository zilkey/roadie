/** Sign in again (another Google account) for a pending Claude connection. See mcp/oauth.ts. */
import { login } from "../../../../mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = login;
