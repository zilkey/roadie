export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The build this server runs (NEXT_PUBLIC_BUILD_ID, fixed in next.config.ts at build time). Open tabs compare it with the
 * build they loaded and offer a reload when it differs (src/lib/useNewVersion.ts). Public and tiny: it says nothing but an id.
 */
export function GET() {
  return Response.json({ buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "" }, { headers: { "cache-control": "no-store" } });
}
