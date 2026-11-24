import { schedulerAllowed } from "@/server/cronAuth";
import { publishDue } from "@/server/scheduledPosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The URL Cloud Scheduler calls, and the audience of its OIDC token. */
const AUDIENCE = "https://app.myroadie.online/api/cron/posts";

/**
 * Scheduled posts (src/server/scheduledPosts.ts): the Cloud Scheduler job `scheduled-posts` calls this every minute and it posts
 * whatever is due. Only that job gets in: a Google OIDC token for its service account (CRON_SCHEDULER_SA).
 */
export async function POST(req: Request) {
  if (!(await schedulerAllowed(req, AUDIENCE, process.env.CRON_SCHEDULER_SA))) return new Response("Unauthorized", { status: 401 });
  const started = Date.now();
  const { due, results } = await publishDue();
  const summary = { due, ms: Date.now() - started, results };
  if (due) console.log(`scheduled-posts cron: ${JSON.stringify(summary)}`);
  return Response.json(summary, { headers: { "cache-control": "no-store" } });
}
