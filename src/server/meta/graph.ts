/**
 * Meta (Instagram) through "API setup with Unified login": the Facebook Login for Business dialog with a configuration
 * (config_id) instead of a scope list. People log in with Instagram or Facebook and pick the business portfolio and the
 * Instagram account in Meta's own dialog. The code comes back as one of two kinds of token (TokenKind), and every later call
 * goes to that kind's host.
 * Config, all server-only (docs/SETUP.md, "Meta (Instagram & Facebook)"):
 * - META_APP_ID: the Meta app. Its presence turns the Instagram & Facebook card on.
 * - META_CONFIG_ID: the Unified login configuration (Instagram use case › API setup with Unified login).
 * - META_APP_SECRET (secret): the code exchange and debug_token, and the HMAC key for `state` and the signed media URLs.
 * - META_TOKEN_KEY (secret): 32 bytes, base64; encrypts the stored token (connection.ts).
 * - META_GRAPH_URL / META_IG_URL / META_DIALOG_URL: graph.facebook.com, graph.instagram.com and the sign-in dialog. Unset in
 *   production; dev and tests point them at fakes/fake-meta.
 * The redirect URI is APP_URL + /api/meta/callback; register it on the app and in the configuration.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appUrl } from "@/lib/app-url";
import { AppError } from "../errors";

const VERSION = "v26.0";
const trim = (u: string) => u.replace(/\/$/, "");
/** graph.facebook.com, for a system-user token. */
export const graphUrl = () => trim(process.env.META_GRAPH_URL || `https://graph.facebook.com/${VERSION}`);
/** graph.instagram.com, for an Instagram User token. Its /access_token and /refresh_access_token aren't versioned. */
const igRoot = () => trim(process.env.META_IG_URL || "https://graph.instagram.com");
const igUrl = () => (process.env.META_IG_URL ? igRoot() : `${igRoot()}/${VERSION}`);
const dialogUrl = () => process.env.META_DIALOG_URL || "https://www.facebook.com/dialog/oauth";
export const metaConfigured = () => !!process.env.META_APP_ID;
export const metaRedirectUri = () => `${appUrl()}/api/meta/callback`;

/**
 * The two tokens Unified login can return. The docs say a Business Integration System User token ("system": owned by the
 * band's business portfolio, keeps working if the person who connected leaves, lifetime set by the configuration, calls on
 * graph.facebook.com). The access-token reference describes an Instagram User token ("instagram": starts with IG, an hour,
 * exchanged for 60 days and renewed, calls on graph.instagram.com). Roadie takes whichever comes back.
 */
export type TokenKind = "system" | "instagram";
export const kindOf = (token: string): TokenKind => (token.startsWith("IG") ? "instagram" : "system");
const base = (kind: TokenKind) => (kind === "instagram" ? igUrl() : graphUrl());

/** What posting can't do without, by token kind (the configuration asks for more, like messages and comments). */
export const NEEDED_PERMISSIONS: Record<TokenKind, readonly string[]> = {
  system: ["instagram_basic", "instagram_content_publish"],
  instagram: ["instagram_business_basic", "instagram_business_content_publish"],
};

function creds() {
  const id = process.env.META_APP_ID, secret = process.env.META_APP_SECRET;
  if (!id || !secret) throw new AppError("meta_not_configured", "Instagram & Facebook aren't set up on this server", 503);
  return { id, secret };
}
const configId = () => {
  const c = process.env.META_CONFIG_ID;
  if (!c) throw new AppError("meta_not_configured", "Instagram & Facebook aren't set up on this server (META_CONFIG_ID)", 503);
  return c;
};
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

/** Meta's Unified login dialog. prompt=login always offers both Instagram and Facebook, even when Facebook is signed in. */
export function metaAuthUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: creds().id, config_id: configId(), redirect_uri: metaRedirectUri(), response_type: "code", state, prompt: "login",
  });
  return `${dialogUrl()}?${q}`;
}

// ---------- the Graph API ----------

/** A Graph error, with Facebook's own message (`message`) and code. */
export class GraphError extends Error {
  constructor(public status: number, message: string, public code?: number, public subcode?: number) { super(message); }
}

type Params = Record<string, string | undefined>;
async function call<T>(root: string, method: "GET" | "POST", path: string, params: Params): Promise<T> {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]);
  const url = `${root}${path}`;
  const res = method === "GET"
    ? await fetch(`${url}?${q}`)
    : await fetch(url, { method, headers: { "content-type": "application/x-www-form-urlencoded" }, body: q });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number; error_subcode?: number } };
  if (!res.ok || data.error) throw new GraphError(res.status, data.error?.message ?? `HTTP ${res.status}`, data.error?.code, data.error?.error_subcode);
  return data;
}

/** A stored token and the host it belongs to. */
export interface Tok { token: string; kind: TokenKind }
const api = <T>(t: Tok, method: "GET" | "POST", path: string, params: Params) => call<T>(base(t.kind), method, path, { ...params, access_token: t.token });

export const graph = {
  /** The dialog's code for a token: a system-user token, or a short-lived Instagram User token (with what was granted). */
  exchangeCode: (code: string) => call<{ access_token: string; expires_in?: number; permissions?: string[] | string }>(graphUrl(), "GET", "/oauth/access_token", {
    client_id: creds().id, client_secret: creds().secret, redirect_uri: metaRedirectUri(), code }),
  /** Instagram User token: the hour-long one for one good for 60 days. */
  longLived: (token: string) => call<{ access_token: string; expires_in: number }>(igRoot(), "GET", "/access_token", {
    grant_type: "ig_exchange_token", client_secret: creds().secret, access_token: token }),
  /** Instagram User token: a new 60 days, once it's at least 24 hours old and before it expires. */
  refresh: (token: string) => call<{ access_token: string; expires_in: number }>(igRoot(), "GET", "/refresh_access_token", {
    grant_type: "ig_refresh_token", access_token: token }),
  /** System-user token: its expiry (0 = never) and what was granted. Asked with the app token. */
  debugToken: (token: string) => call<{ data: { is_valid?: boolean; type?: string; expires_at?: number; scopes?: string[] } }>(graphUrl(), "GET", "/debug_token", {
    input_token: token, access_token: `${creds().id}|${creds().secret}` }),
  /** System-user token: the band's business portfolio (/me is the integration's system user, not a person). */
  business: (t: Tok) => api<{ id: string; client_business_id?: string }>(t, "GET", "/me", { fields: "client_business_id" }),
  /** System-user token: the Instagram accounts the person shared in Meta's dialog. */
  assignedAccounts: (t: Tok) => api<{ data: { id: string; username?: string }[] }>(t, "GET", "/me/assigned_instagram_accounts", { fields: "id,username" }),
  /** Instagram User token: the account it belongs to. */
  igMe: (t: Tok) => api<{ user_id?: string; id: string; username: string }>(t, "GET", "/me", { fields: "user_id,username" }),
  igUser: (igId: string, t: Tok) => api<{ id: string; username: string }>(t, "GET", `/${encodeURIComponent(igId)}`, { fields: "username" }),
  createImage: (igId: string, t: Tok, imageUrl: string, caption: string) =>
    api<{ id: string }>(t, "POST", `/${encodeURIComponent(igId)}/media`, { image_url: imageUrl, caption }),
  container: (id: string, t: Tok) => api<{ status_code?: string; status?: string }>(t, "GET", `/${encodeURIComponent(id)}`, { fields: "status_code,status" }),
  publish: (igId: string, t: Tok, creationId: string) => api<{ id: string }>(t, "POST", `/${encodeURIComponent(igId)}/media_publish`, { creation_id: creationId }),
  permalink: (mediaId: string, t: Tok) => api<{ permalink?: string }>(t, "GET", `/${encodeURIComponent(mediaId)}`, { fields: "permalink" }),
};
