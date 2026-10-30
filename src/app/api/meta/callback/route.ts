import { appUrl } from "@/lib/app-url";
import { artistPath } from "@/lib/routes";
import { metaConfigured, verifyMetaState } from "@/server/meta/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Facebook's redirect after its sign-in dialog. Like the Google callback, it only forwards: code and state (or Facebook's
 * error) go on to the artist's Settings › Integrations page, which finishes with meta.finishConnect as the signed-in admin.
 * So the Page token is stored only when the session that completes it is the admin who started it, for that band.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const state = q.get("state") ?? "";
  const s = metaConfigured() ? verifyMetaState(state) : null;
  if (!s) return new Response("This Facebook sign-in link has expired. Go back to Roadie and press Connect with Facebook again.", { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  const err = q.get("error_reason") ?? q.get("error");
  const out = new URLSearchParams(err ? { meta_error: err } : { meta_code: q.get("code") ?? "", meta_state: state });
  return Response.redirect(`${appUrl()}${artistPath(s.slug, "/admin/mcp")}?${out}`, 303);
}
