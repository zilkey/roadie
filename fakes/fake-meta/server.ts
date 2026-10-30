/**
 * Fake Meta: the Unified login dialog and the bits of the Graph API Roadie calls, on both hosts: graph.facebook.com at the
 * root (code exchange, debug_token, /me, /me/assigned_instagram_accounts) and graph.instagram.com under /ig (ig_exchange_token,
 * ig_refresh_token, /me), each with the Instagram user, photo containers and publishing. The code comes back as a system-user
 * token (kind "system", what the Unified login docs describe) or an Instagram User token (kind "instagram", IG…, an hour, then
 * 60 days, renewable once it's 24 hours old). It fetches each container's image_url like Meta does, so the signed media route is
 * exercised for real. POST /__scenario sets what the next sign-in finds:
 * { scenario: one | several | none | personal | declined | cancel, kind, systemExpiresIn (seconds, 0 = never), revoked,
 *   failContainers, fetchMedia, ageHours (makes every token issued so far that many hours older) }.
 */
import { defineFake, runIfMain, esc, HttpError, type Route } from "../lib";

export type MetaScenario = "one" | "several" | "none" | "personal" | "declined" | "cancel";
type Kind = "system" | "instagram";
interface Token { token: string; kind: Kind; long: boolean; issuedAt: number; expiresAt: number /* 0 = never */ }
interface Container { id: string; igId: string; imageUrl: string; caption: string; status_code: "FINISHED" | "ERROR" | "PUBLISHED"; status: string }
interface Media { id: string; igId: string; caption: string; imageUrl: string; permalink: string; at: string }
export interface MetaState {
  seq: number;
  scenario: MetaScenario;
  kind: Kind;
  /** How long a system-user token lasts, in seconds; 0 = never (the configuration decides on the real app). */
  systemExpiresIn: number;
  /** The sign-in was revoked (a password change, the app removed from the portfolio): Graph answers with Meta's error. */
  revoked: boolean;
  /** Containers end in ERROR, as when Instagram can't use the photo. */
  failContainers: boolean;
  /** Fetch image_url when a container is made (off where nothing serves it). */
  fetchMedia: boolean;
  tokens: Token[];
  containers: Container[];
  media: Media[];
}

const initial = (): MetaState => ({
  seq: 0, scenario: "one", kind: "system", systemExpiresIn: 0, revoked: false, failContainers: false, fetchMedia: true, tokens: [], containers: [], media: [],
});

const IG: Record<string, string> = { "ig-1": "ingridavisonband", "ig-2": "ingridsolo" };
const SCOPES: Record<Kind, string[]> = {
  system: ["instagram_basic", "instagram_content_publish", "instagram_manage_messages", "instagram_manage_comments"],
  instagram: ["instagram_business_basic", "instagram_business_content_publish"],
};
const DAY = 24 * 60 * 60_000;

const graphError = (message: string, code = 100, status = 400) => ({ status, json: { error: { message, type: "OAuthException", code } } });
const PERSONAL = graphError("(#10) Access is denied because the instagram account type is not business or creator.", 10, 403);
const REVOKED = "Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons.";

function issue(s: MetaState, kind: Kind, long: boolean, seconds: number): Token {
  const t: Token = { token: `${kind === "instagram" ? "IGAA" : "EAAsys"}${long ? "long" : "short"}-${++s.seq}`, kind, long, issuedAt: Date.now(), expiresAt: seconds ? Date.now() + seconds * 1000 : 0 };
  s.tokens.push(t);
  return t;
}
const scopes = (s: MetaState, kind: Kind) => SCOPES[kind].filter((p) => !(s.scenario === "declined" && p.endsWith("content_publish")));
const left = (t: Token) => Math.round((t.expiresAt - Date.now()) / 1000);

/** The token on a call: known, not expired, not revoked. Answers with Meta's error otherwise. */
function tokenOf(s: MetaState, v: unknown): Token | { status: number; json: unknown } {
  if (!v) throw new HttpError(400, "An access token is required to request this resource.");
  const t = s.tokens.find((x) => x.token === v);
  if (!t) return graphError("Invalid OAuth access token - Cannot parse access token", 190);
  if (s.revoked) return graphError(REVOKED, 190);
  if (t.expiresAt && t.expiresAt <= Date.now()) return graphError("Error validating access token: Session has expired.", 190);
  return t;
}
const isErr = (t: Token | { status: number; json: unknown }): t is { status: number; json: unknown } => "json" in t;

/** The Graph calls both hosts answer the same way: the Instagram user, containers, publishing, permalinks. */
const content = (prefix: string): Route<MetaState>[] => [
  ["POST", `${prefix}/:igId/media`, async ({ params, body }, s) => {
    const t = tokenOf(s, body.access_token);
    if (isErr(t)) return t;
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
  ["POST", `${prefix}/:igId/media_publish`, ({ params, body }, s) => {
    const t = tokenOf(s, body.access_token);
    if (isErr(t)) return t;
    const c = s.containers.find((x) => x.id === body.creation_id && x.igId === params.igId);
    if (!c || c.status_code !== "FINISHED") return graphError("Media ID is not available", 9007);
    c.status_code = "PUBLISHED";
    const m: Media = { id: `media-${++s.seq}`, igId: c.igId, caption: c.caption, imageUrl: c.imageUrl, permalink: `https://www.instagram.com/p/FAKE${s.seq}/`, at: new Date().toISOString() };
    s.media.push(m);
    return { id: m.id };
  }],
  // One node by id: an Instagram user, a container or a published photo.
  ["GET", `${prefix}/:id`, ({ params, query }, s) => {
    const t = tokenOf(s, query.get("access_token"));
    if (isErr(t)) return t;
    if (IG[params.id]) return s.scenario === "personal" ? PERSONAL : { id: params.id, username: IG[params.id] };
    const c = s.containers.find((x) => x.id === params.id);
    if (c) return { id: c.id, status_code: c.status_code, status: c.status };
    const m = s.media.find((x) => x.id === params.id);
    if (m) return { id: m.id, permalink: m.permalink };
    return graphError(`Unsupported get request. Object with ID '${params.id}' does not exist.`);
  }],
];

const routes: Route<MetaState>[] = [
  // The Unified login dialog: no screen, it answers at once with a code (or "cancel": the person pressed Cancel).
  ["GET", "/dialog/oauth", ({ query }, s) => {
    if (!query.get("config_id")) throw new HttpError(400, "Missing config_id: Unified login needs a configuration.");
    const back = new URL(query.get("redirect_uri") ?? "");
    back.searchParams.set("state", query.get("state") ?? "");
    if (s.scenario === "cancel") { back.searchParams.set("error", "access_denied"); back.searchParams.set("error_reason", "user_denied"); }
    else back.searchParams.set("code", `fake-code-${++s.seq}`);
    return { redirect: back.toString() };
  }],
  // graph.facebook.com: the code for a token of the scenario's kind.
  ["GET", "/oauth/access_token", ({ query }, s) => {
    if (!query.get("client_secret")) return graphError("Missing client_secret parameter.");
    if (!query.get("code")) return graphError("Missing authorization code");
    if (s.kind === "instagram") {
      const t = issue(s, "instagram", false, 3600);
      return { access_token: t.token, token_type: "bearer", expires_in: 3600, permissions: scopes(s, "instagram") };
    }
    const t = issue(s, "system", true, s.systemExpiresIn);
    return { access_token: t.token, token_type: "bearer", ...(t.expiresAt ? { expires_in: left(t) } : {}) };
  }],
  ["GET", "/debug_token", ({ query }, s) => {
    if (!query.get("access_token")?.includes("|")) return graphError("Invalid app access token");
    const t = s.tokens.find((x) => x.token === query.get("input_token"));
    if (!t || t.kind !== "system") return { data: { is_valid: false, error: { message: "Invalid OAuth access token", code: 190 } } };
    return { data: { is_valid: !s.revoked, type: "SYSTEM_USER", expires_at: t.expiresAt ? Math.floor(t.expiresAt / 1000) : 0, scopes: scopes(s, "system") } };
  }],
  ["GET", "/me/assigned_instagram_accounts", ({ query }, s) => {
    const t = tokenOf(s, query.get("access_token"));
    if (isErr(t)) return t;
    if (s.scenario === "personal") return PERSONAL;
    const ids = s.scenario === "none" ? [] : s.scenario === "several" ? ["ig-1", "ig-2"] : ["ig-1"];
    return { data: ids.map((id) => ({ id, username: IG[id] })) };
  }],
  ["GET", "/me", ({ query }, s) => {
    const t = tokenOf(s, query.get("access_token"));
    if (isErr(t)) return t;
    return { id: "system-user-1", client_business_id: "business-1" };
  }],
  // graph.instagram.com
  ["GET", "/ig/access_token", ({ query }, s) => {
    if (query.get("grant_type") !== "ig_exchange_token") return graphError("Unsupported grant_type");
    if (!query.get("client_secret")) return graphError("Missing client_secret parameter.");
    const t = tokenOf(s, query.get("access_token"));
    if (isErr(t)) return t;
    if (t.kind !== "instagram" || t.long) return graphError("Invalid OAuth access token - Cannot parse access token", 190);
    const l = issue(s, "instagram", true, 60 * 24 * 60 * 60);
    return { access_token: l.token, token_type: "bearer", expires_in: left(l) };
  }],
  ["GET", "/ig/refresh_access_token", ({ query }, s) => {
    if (query.get("grant_type") !== "ig_refresh_token") return graphError("Unsupported grant_type");
    const t = tokenOf(s, query.get("access_token"));
    if (isErr(t)) return t;
    if (t.kind !== "instagram" || !t.long) return graphError("Invalid OAuth access token - Cannot parse access token", 190);
    if (Date.now() - t.issuedAt < DAY) return graphError("The access token can't be refreshed until it is at least 24 hours old.", 190);
    const l = issue(s, "instagram", true, 60 * 24 * 60 * 60);
    return { access_token: l.token, token_type: "bearer", expires_in: left(l) };
  }],
  ["GET", "/ig/me", ({ query }, s) => {
    const t = tokenOf(s, query.get("access_token"));
    if (isErr(t)) return t;
    if (s.scenario === "personal") return PERSONAL;
    return { id: "ig-app-scoped-1", user_id: "ig-1", username: IG["ig-1"] };
  }],
  ["POST", "/__scenario", ({ body }, s) => {
    for (const k of ["scenario", "kind", "systemExpiresIn", "revoked", "failContainers", "fetchMedia"] as const) if (body[k] !== undefined) (s as unknown as Record<string, unknown>)[k] = body[k];
    if (body.ageHours) for (const t of s.tokens) t.issuedAt -= Number(body.ageHours) * 60 * 60_000;
    return { ok: true };
  }],
  ...content("/ig"),
  ...content(""),
];

export const fakeMeta = defineFake<MetaState>({
  name: "fake-meta", defaultPort: 3208, initial, routes, formApi: true,
  page: (s) => `<p>Scenario: <b>${esc(s.scenario)}</b> · ${esc(s.kind)} token${s.revoked ? " · revoked" : ""}${s.failContainers ? " · containers fail" : ""}</p>
<h2>Published</h2><table><tr><th>Id</th><th>Account</th><th>Caption</th><th>Image URL</th><th>At</th></tr>${s.media.slice().reverse().map((m) =>
    `<tr><td>${esc(m.id)}</td><td>@${esc(IG[m.igId])}</td><td><pre>${esc(m.caption)}</pre></td><td>${esc(m.imageUrl.split("?")[0])}</td><td>${esc(m.at)}</td></tr>`).join("")}</table>`,
});
runIfMain(import.meta, fakeMeta);
