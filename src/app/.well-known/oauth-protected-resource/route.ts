/** OAuth protected-resource metadata (RFC 9728) for /mcp, so Claude's connectors can find sign-in. See mcp/oauth.ts. */
import { preflight, protectedResourceMetadata } from "../../../../mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = protectedResourceMetadata;
export const OPTIONS = preflight;
