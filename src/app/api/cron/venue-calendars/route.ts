import { cronAllowed } from "@/server/cronAuth";
import { refreshStale } from "@/server/events/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The URL the workflow calls, and the audience of its OIDC token. */
const AUDIENCE = "https://app.myroadie.online/api/cron/venue-calendars";

/**
 * The nightly venue-calendar refresh (docs/designs/venue-refresh.md): .github/workflows/venue-calendars.yml calls this every 15
 * minutes overnight; each call refreshes the few stalest calendars (refreshStale) and logs one line. Only that workflow, on main,
 * gets in (its GitHub OIDC token; CRON_GITHUB_REPO names the repo).
 */
export async function POST(req: Request) {
  if (!(await cronAllowed(req, AUDIENCE, { repository: process.env.CRON_GITHUB_REPO, workflow: "venue-calendars.yml" }))) return new Response("Unauthorized", { status: 401 });
  const started = Date.now();
  const { picked, results } = await refreshStale();
  const summary = {
    picked: picked.length, ms: Date.now() - started,
    added: results.reduce((n, r) => n + r.added, 0), gone: results.reduce((n, r) => n + r.gone, 0),
    venues: results.map((r) => ({ id: r.venueId, count: r.count, added: r.added, gone: r.gone, ...(r.error ? { error: r.error.slice(0, 120) } : {}) })),
  };
  console.log(`venue-calendars cron: ${JSON.stringify(summary)}`);
  return Response.json(summary, { headers: { "cache-control": "no-store" } });
}
