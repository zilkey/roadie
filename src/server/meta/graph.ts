/**
 * Meta (Instagram & Facebook) through Facebook Login: the "Instagram API with Facebook Login" path, graph.facebook.com.
 * Config, all server-only (docs/SETUP.md, "Meta (Instagram & Facebook)"):
 * - META_APP_ID: the Meta app. Its presence turns the Instagram & Facebook card on.
 * - META_APP_SECRET (secret): the code exchange and debug_token, and the HMAC key for `state` and the signed media URLs.
 * - META_TOKEN_KEY (secret): 32 bytes, base64; encrypts the stored Page token (connection.ts).
 * - META_GRAPH_URL / META_DIALOG_URL: the Graph API and the sign-in dialog. Unset in production; dev and tests point them
 *   at fakes/fake-meta.
 * The redirect URI is APP_URL + /api/meta/callback; register it on the app.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appUrl } from "@/lib/app-url";
import { AppError } from "../errors";

const VERSION = "v24.0";
export const graphUrl = () => (process.env.META_GRAPH_URL || `https://graph.facebook.com/${VERSION}`).replace(/\/$/, "");
const dialogUrl = () => process.env.META_DIALOG_URL || `https://www.facebook.com/${VERSION}/dialog/oauth`;
export const metaConfigured = () => !!process.env.META_APP_ID;
export const metaRedirectUri = () => `${appUrl()}/api/meta/callback`;

/** What Roadie asks for. business_management is needed when the Page sits in a business portfolio. */
export const META_PERMISSIONS = ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish", "business_management"] as const;
/** The ones posting can't do without (business_management only matters for some Pages). */
export const NEEDED_PERMISSIONS: readonly string[] = ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"];

function creds() {
  const id = process.env.META_APP_ID, secret = process.env.META_APP_SECRET;
  if (!id || !secret) throw new AppError("meta_not_configured", "Instagram & Facebook aren't set up on this server", 503);
  return { id, secret };
}
export const hmac = (body: string) => createHmac("sha256", creds().secret).update(body).digest("base64url");
export function sameMac(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------- state: who started the flow, for which band ----------

export interface MetaState { uid: string; artistId: string; slug: string; exp: number; n: string }

export function signMetaState(s: Pick<MetaState, "uid" | "artistId" | "slug">, ttlMs = 15 * 60_000): string {
  const body = Buffer.from(JSON.stringify({ ...s, exp: Date.now() + ttlMs, n: randomBytes(9).toString("base64url") })).toString("base64url");
  return `${body}.${hmac(`meta.${body}`)}`;
}

/** The state's contents, or null when it's tampered with, malformed or expired. */
export function verifyMetaState(state: string, now = Date.now()): MetaState | null {
  const [body, mac] = state.split(".");
  if (!body || !mac || !sameMac(hmac(`meta.${body}`), mac)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MetaState;
    return s.exp > now ? s : null;
  } catch { return null; }
}

/** Facebook's sign-in dialog. rerequest asks again for anything declined last time. */
export function metaAuthUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: creds().id, redirect_uri: metaRedirectUri(), response_type: "code", state,
    scope: META_PERMISSIONS.join(","), auth_type: "rerequest",
  });
  return `${dialogUrl()}?${q}`;
}

// ---------- the Graph API ----------

/** A Graph error, with Facebook's own message (`message`) and code. */
export class GraphError extends Error {
  constructor(public status: number, message: string, public code?: number, public subcode?: number) { super(message); }
}

type Params = Record<string, string | undefined>;
async function call<T>(method: "GET" | "POST", path: string, params: Params): Promise<T> {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]);
  const url = `${graphUrl()}${path}`;
  const res = method === "GET"
    ? await fetch(`${url}?${q}`)
    : await fetch(url, { method, headers: { "content-type": "application/x-www-form-urlencoded" }, body: q });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number; error_subcode?: number } };
  if (!res.ok || data.error) throw new GraphError(res.status, data.error?.message ?? `HTTP ${res.status}`, data.error?.code, data.error?.error_subcode);
  return data;
}

export const graph = {
  /** The dialog's code for a short-lived user token. */
  exchangeCode: (code: string) => call<{ access_token: string }>("GET", "/oauth/access_token", {
    client_id: creds().id, client_secret: creds().secret, redirect_uri: metaRedirectUri(), code }),
  /** A short-lived user token for a long-lived one (about 60 days). */
  longLived: (token: string) => call<{ access_token: string; expires_in?: number }>("GET", "/oauth/access_token", {
    grant_type: "fb_exchange_token", client_id: creds().id, client_secret: creds().secret, fb_exchange_token: token }),
  permissions: (token: string) => call<{ data: { permission: string; status: string }[] }>("GET", "/me/permissions", { access_token: token }),
  /** The Pages the person granted, each with its Page token (one that never expires, when the user token is long-lived). */
  pages: (token: string) => call<{ data: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[] }>(
    "GET", "/me/accounts", { fields: "name,access_token,instagram_business_account{id,username}", access_token: token }),
  /** expires_at 0 = never. Asked with the app token. */
  debugToken: (token: string) => call<{ data: { is_valid?: boolean; expires_at?: number } }>("GET", "/debug_token", {
    input_token: token, access_token: `${creds().id}|${creds().secret}` }),
  igUser: (igId: string, token: string) => call<{ id: string; username: string }>("GET", `/${encodeURIComponent(igId)}`, { fields: "username", access_token: token }),
  createImage: (igId: string, token: string, imageUrl: string, caption: string) =>
    call<{ id: string }>("POST", `/${encodeURIComponent(igId)}/media`, { image_url: imageUrl, caption, access_token: token }),
  container: (id: string, token: string) => call<{ status_code?: string; status?: string }>("GET", `/${encodeURIComponent(id)}`, { fields: "status_code,status", access_token: token }),
  publish: (igId: string, token: string, creationId: string) => call<{ id: string }>("POST", `/${encodeURIComponent(igId)}/media_publish`, { creation_id: creationId, access_token: token }),
  permalink: (mediaId: string, token: string) => call<{ permalink?: string }>("GET", `/${encodeURIComponent(mediaId)}`, { fields: "permalink", access_token: token }),
};
