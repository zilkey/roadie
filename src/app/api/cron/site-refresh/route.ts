import { cronAllowed } from "@/server/cronAuth";
import { refreshAll } from "@/server/sites/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The URL the workflow calls, and the audience of its OIDC token. */
const AUDIENCE = "https://app.myroadie.online/api/cron/site-refresh";

/**
 * The website refresh (docs/designs/sites, Decision 5): .github/workflows/site-refresh.yml calls this every 10 minutes. For every
 * site it reconciles with Firebase Hosting, then re-renders a version whose show list or links changed. Only that workflow, on
 * main, gets in (its GitHub OIDC token).
 */
export async function POST(req: Request) {
  if (!(await cronAllowed(req, AUDIENCE, { repository: process.env.CRON_GITHUB_REPO, workflow: "site-refresh.yml" }))) return new Response("Unauthorized", { status: 401 });
  const started = Date.now();
  const results = await refreshAll();
  const summary = { sites: results.length, ms: Date.now() - started, results };
  console.log(`site-refresh cron: ${JSON.stringify(summary)}`);
  return Response.json(summary, { headers: { "cache-control": "no-store" } });
}
