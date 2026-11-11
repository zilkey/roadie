/** The path-suffixed form of the protected-resource metadata, the address /mcp's 401 points to. See mcp/oauth.ts. */
import { preflight, protectedResourceMetadata } from "../../../../../mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = protectedResourceMetadata;
export const OPTIONS = preflight;
