/**
 * Fake Meta: Facebook's sign-in dialog and the bits of the Graph API Roadie calls (code exchange, long-lived token,
 * permissions, Pages, debug_token, the Instagram user, photo containers and publishing). It fetches each container's
 * image_url like Meta does, so the signed media route is exercised for real. POST /__scenario sets what the next sign-in
 * finds: { scenario: one | several | none | noInstagram | declined | cancel, revoked, failContainers, fetchMedia }.
 */
import { defineFake, runIfMain, esc, HttpError, type Route } from "../lib";

export type MetaScenario = "one" | "several" | "none" | "noInstagram" | "declined" | "cancel";
interface Container { id: string; igId: string; imageUrl: string; caption: string; status_code: "FINISHED" | "ERROR" | "PUBLISHED"; status: string }
interface Media { id: string; igId: string; caption: string; imageUrl: string; permalink: string; at: string }
export interface MetaState {
  seq: number;
  scenario: MetaScenario;
  /** The Page token was revoked (a password change): the Instagram user answers with Facebook's error. */
  revoked: boolean;
  /** Containers end in ERROR, as when Instagram can't use the photo. */
  failContainers: boolean;
  /** Fetch image_url when a container is made (off where nothing serves it). */
  fetchMedia: boolean;
  containers: Container[];
  media: Media[];
}

const initial = (): MetaState => ({ seq: 0, scenario: "one", revoked: false, failContainers: false, fetchMedia: true, containers: [], media: [] });

const BAND = { id: "page-1", name: "Ingrid Avison Band", access_token: "page-token-1", instagram_business_account: { id: "ig-1", username: "ingridavisonband" } };
const SOLO = { id: "page-2", name: "Ingrid Avison", access_token: "page-token-2", instagram_business_account: { id: "ig-2", username: "ingridsolo" } };
const IG: Record<string, string> = { "ig-1": "ingridavisonband", "ig-2": "ingridsolo" };
const PERMS = ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish", "business_management"];

const graphError = (message: string, code = 100, status = 400) => ({ status, json: { error: { message, type: "OAuthException", code } } });
const needToken = (t: unknown) => { if (!t) throw new HttpError(400, "An access token is required to request this resource."); };

const routes: Route<MetaState>[] = [
  // The sign-in dialog: no screen, it answers at once with a code (or "cancel": the person pressed Cancel).
  ["GET", "/dialog/oauth", ({ query }, s) => {
    const back = new URL(query.get("redirect_uri") ?? "");
    back.searchParams.set("state", query.get("state") ?? "");
    if (s.scenario === "cancel") { back.searchParams.set("error", "access_denied"); back.searchParams.set("error_reason", "user_denied"); }
    else back.searchParams.set("code", `fake-code-${++s.seq}`);
    return { redirect: back.toString() };
  }],
  ["GET", "/oauth/access_token", ({ query }, s) => {
    if (!query.get("client_secret")) return graphError("Missing client_secret parameter.");
    if (query.get("grant_type") === "fb_exchange_token") return { access_token: `long-${query.get("fb_exchange_token")}`, token_type: "bearer", expires_in: 5183944 };
    if (!query.get("code")) return graphError("Missing authorization code");
    return { access_token: `short-${++s.seq}`, token_type: "bearer", expires_in: 3600 };
  }],
  ["GET", "/me/permissions", ({ query }, s) => {
    needToken(query.get("access_token"));
    return { data: PERMS.map((permission) => ({ permission, status: s.scenario === "declined" && permission === "instagram_content_publish" ? "declined" : "granted" })) };
  }],
  ["GET", "/me/accounts", ({ query }, s) => {
    needToken(query.get("access_token"));
    const pages = s.scenario === "none" ? [] : s.scenario === "several" ? [BAND, SOLO]
      : s.scenario === "noInstagram" ? [{ id: BAND.id, name: BAND.name, access_token: BAND.access_token }] : [BAND];
    return { data: pages };
  }],
  ["GET", "/debug_token", ({ query }) => {
    const t = query.get("input_token") ?? "";
    if (!query.get("access_token")?.includes("|")) return graphError("Invalid app access token");
    return { data: { is_valid: true, type: t.startsWith("page-token") ? "PAGE" : "USER", expires_at: t.startsWith("page-token") ? 0 : Math.floor(Date.now() / 1000) + 5183944 } };
  }],
  ["POST", "/:igId/media", async ({ params, body }, s) => {
    needToken(body.access_token);
    if (!IG[params.igId]) return graphError("Unsupported post request.");
    if (!body.image_url) return graphError("The parameter image_url is required.");
    const c: Container = { id: `container-${++s.seq}`, igId: params.igId, imageUrl: body.image_url, caption: body.caption ?? "", status_code: "FINISHED", status: "Finished: Media has been uploaded and it is ready to be published." };
    if (s.failContainers) Object.assign(c, { status_code: "ERROR", status: "Error: The aspect ratio is not supported." });
    else if (s.fetchMedia) {
      const res = await fetch(c.imageUrl).catch(() => null);
      if (!res?.ok || !res.headers.get("content-type")?.startsWith("image/jpeg")) Object.assign(c, { status_code: "ERROR", status: "Error: Media download has failed. The media URI doesn't meet our requirements." });
    }
    s.containers.push(c);
    return { id: c.id };
  }],
  ["POST", "/:igId/media_publish", ({ params, body }, s) => {
    needToken(body.access_token);
    const c = s.containers.find((x) => x.id === body.creation_id && x.igId === params.igId);
    if (!c || c.status_code !== "FINISHED") return graphError("Media ID is not available", 9007);
    c.status_code = "PUBLISHED";
    const m: Media = { id: `media-${++s.seq}`, igId: c.igId, caption: c.caption, imageUrl: c.imageUrl, permalink: `https://www.instagram.com/p/FAKE${s.seq}/`, at: new Date().toISOString() };
    s.media.push(m);
    return { id: m.id };
  }],
  // One node by id: an Instagram user, a container or a published photo.
  ["GET", "/:id", ({ params, query }, s) => {
    needToken(query.get("access_token"));
    if (IG[params.id]) {
      if (s.revoked) return graphError("Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons.", 190);
      return { id: params.id, username: IG[params.id] };
    }
    const c = s.containers.find((x) => x.id === params.id);
    if (c) return { id: c.id, status_code: c.status_code, status: c.status };
    const m = s.media.find((x) => x.id === params.id);
    if (m) return { id: m.id, permalink: m.permalink };
    return graphError(`Unsupported get request. Object with ID '${params.id}' does not exist.`);
  }],
  ["POST", "/__scenario", ({ body }, s) => {
    for (const k of ["scenario", "revoked", "failContainers", "fetchMedia"] as const) if (body[k] !== undefined) (s as unknown as Record<string, unknown>)[k] = body[k];
    return { ok: true };
  }],
];

export const fakeMeta = defineFake<MetaState>({
  name: "fake-meta", defaultPort: 3208, initial, routes, formApi: true,
  page: (s) => `<p>Scenario: <b>${esc(s.scenario)}</b>${s.revoked ? " · token revoked" : ""}${s.failContainers ? " · containers fail" : ""}</p>
<h2>Published</h2><table><tr><th>Id</th><th>Account</th><th>Caption</th><th>Image URL</th><th>At</th></tr>${s.media.slice().reverse().map((m) =>
    `<tr><td>${esc(m.id)}</td><td>@${esc(IG[m.igId])}</td><td><pre>${esc(m.caption)}</pre></td><td>${esc(m.imageUrl.split("?")[0])}</td><td>${esc(m.at)}</td></tr>`).join("")}</table>`,
});
runIfMain(import.meta, fakeMeta);
