import { appUrl } from "@/lib/app-url";
import { artistPath } from "@/lib/routes";
import { googleConfigured, verifyState } from "@/server/google/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google's redirect after the consent screen. It only forwards: code and state (or Google's error) go on to the
 * artist's Settings > Google page, which finishes with google.finishConnect as the signed-in admin. That way the grant
 * is stored only for the person whose session completes it, and only if the signed state is theirs.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const state = q.get("state") ?? "";
  const s = googleConfigured() ? verifyState(state) : null;
  if (!s) return new Response("This Google sign-in link has expired. Go back to Roadie and press Connect again.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  const out = new URLSearchParams(q.get("error") ? { error: q.get("error")! } : { code: q.get("code") ?? "", state });
  return Response.redirect(`${appUrl()}${artistPath(s.slug, "/admin/google")}?${out}`, 303);
}
