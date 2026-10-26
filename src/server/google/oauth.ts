/**
 * Google OAuth for Gmail, Calendar and Drive (web server flow, offline access). Each admin connects their own Google
 * account on Settings > Google, choosing which features it's for; only those scopes are asked for, added to what they
 * granted before (include_granted_scopes). Config, all server-only:
 * - GOOGLE_OAUTH_CLIENT_ID: the OAuth web client. Its presence switches the Google clients from the fakes to the real APIs.
 * - GOOGLE_OAUTH_CLIENT_SECRET (secret): also the HMAC key for the `state` parameter.
 * - GOOGLE_TOKEN_KEY (secret): 32 bytes, base64; encrypts refresh tokens at rest (grants.ts).
 * The redirect URI is APP_URL + /api/google/callback; register it on the OAuth client.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appUrl } from "@/lib/app-url";
import { AppError } from "../errors";

export const GOOGLE_FEATURES = ["gmail", "calendar", "drive"] as const;
export type GoogleFeature = (typeof GOOGLE_FEATURES)[number];

/** What each feature asks for. Gmail: compose covers sending and drafts; readonly is for reading replies in threads Roadie started. */
export const FEATURE_SCOPES: Record<GoogleFeature, string[]> = {
  gmail: ["https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.readonly"],
  calendar: ["https://www.googleapis.com/auth/calendar.events"],
  // Full Drive: search files the band doesn't own, read who they're shared with, copy into the band folder, share. drive.file can't.
  drive: ["https://www.googleapis.com/auth/drive"],
};
const ID_SCOPES = ["openid", "email"];

/** Which features a granted scope string covers (a feature counts only when all its scopes are there). */
export function featuresOf(scopes: string[]): GoogleFeature[] {
  return GOOGLE_FEATURES.filter((f) => FEATURE_SCOPES[f].every((s) => scopes.includes(s)));
}

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const googleConfigured = () => !!process.env.GOOGLE_OAUTH_CLIENT_ID;
export const redirectUri = () => `${appUrl()}/api/google/callback`;

function clientCreds() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID, secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) throw new AppError("google_not_configured", "Google isn't set up on this server", 503);
  return { id, secret };
}

// ---------- state: who started the flow, signed so the callback and finish step can trust it ----------

export interface OAuthState { uid: string; artistId: string; slug: string; features: GoogleFeature[]; exp: number; n: string }
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (body: string) => createHmac("sha256", clientCreds().secret).update(body).digest("base64url");

export function signState(s: Omit<OAuthState, "exp" | "n">, ttlMs = 15 * 60_000): string {
  const body = b64url(JSON.stringify({ ...s, exp: Date.now() + ttlMs, n: randomBytes(9).toString("base64url") }));
  return `${body}.${sign(body)}`;
}

/** The state's contents, or null when it's tampered with, malformed or expired. */
export function verifyState(state: string, now = Date.now()): OAuthState | null {
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    return s.exp > now ? s : null;
  } catch { return null; }
}

// ---------- the Google endpoints ----------

export function authUrl(state: string, features: GoogleFeature[], loginHint?: string): string {
  const scopes = [...ID_SCOPES, ...features.flatMap((f) => FEATURE_SCOPES[f])];
  const q = new URLSearchParams({
    client_id: clientCreds().id, redirect_uri: redirectUri(), response_type: "code", scope: scopes.join(" "),
    // offline + consent: Google returns a refresh token every time, covering everything granted so far.
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `${AUTH_URL}?${q}`;
}

export interface TokenResponse { access_token: string; expires_in: number; refresh_token?: string; scope: string; id_token?: string }

async function tokenCall(params: Record<string, string>): Promise<TokenResponse> {
  const { id, secret } = clientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) throw new GoogleAuthError(data.error ?? `HTTP ${res.status}`, data.error_description);
  return data;
}

export class GoogleAuthError extends Error {
  constructor(public code: string, description?: string) { super(description ? `${code}: ${description}` : code); }
}

export const exchangeCode = (code: string) => tokenCall({ code, redirect_uri: redirectUri(), grant_type: "authorization_code" });
export const refreshAccess = (refreshToken: string) => tokenCall({ refresh_token: refreshToken, grant_type: "refresh_token" });

/** Revoke a grant at Google. Best effort: an already revoked or expired token is fine. */
export async function revoke(token: string): Promise<void> {
  await fetch(`${REVOKE_URL}?${new URLSearchParams({ token })}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }).catch(() => undefined);
}

/** The Google account's email from the id_token. It came straight from Google's token endpoint over TLS, so it isn't re-verified. */
export function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string };
    return claims.email?.toLowerCase() ?? null;
  } catch { return null; }
}
