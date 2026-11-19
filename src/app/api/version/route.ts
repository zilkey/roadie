import { layout } from "@/server/layout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The build this server runs (NEXT_PUBLIC_BUILD_ID, fixed in next.config.ts at build time), and where artist data lives and whether
 * Roadie is read-only (tenancy phase 10, platform/config). Open tabs compare the build and the layout with what they loaded and offer
 * a reload when either differs (src/lib/useNewVersion.ts), and show a banner while read-only. Public and tiny: an id and two flags.
 */
export async function GET() {
  const { nestedPaths, readOnly } = await layout();
  return Response.json({ buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "", nestedPaths, readOnly }, { headers: { "cache-control": "no-store" } });
}
