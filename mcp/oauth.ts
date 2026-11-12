/**
 * OAuth for the MCP server, so Claude's "Add custom connector" (claude.ai, desktop and mobile apps) can sign in. Those
 * clients don't take a pasted header: on a 401 from /mcp they read the protected-resource metadata, then the
 * authorization-server metadata, register themselves (RFC 7591) and run authorization code + PKCE. Without these
 * endpoints the app says "Couldn't start sign-in".
 *
 * Signing in is your normal Roadie sign-in: /oauth/authorize checks the request and sends the browser to /connect, which
 * signs you in with Google (or uses the sign-in you already have), lets you pick the artist and calls /oauth/approve.
 * The token endpoint then mints an MCP key (btk_..., stored hashed in mcpTokens like any other) and hands it to Claude as
 * the access token, so /mcp's bearer check works exactly as with Claude Code's header. Turning off someone's AI access
 * stops it at once; connecting the same client again replaces its previous key.
 *
 * Stateless like mcp/web.ts (App Hosting scales to zero, up to two instances): client ids, codes and refresh tokens are
 * sealed (AES-256-GCM) with a key derived from MCP_SESSION_SECRET, so any instance can open them and nothing is stored.
 * Codes expire after five minutes and are bound to the client, the redirect URI and the PKCE challenge; the person
 * gets fifteen minutes on /connect.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appUrl } from "@/lib/app-url";
import { AppError } from "@/server/errors";
import { authenticateToken, mintKey } from "./auth";
import { adminAuth } from "@/server/admin";
import { db } from "@/server/db";
import { mcpIn, type Membership } from "@/schema/users";
import { AUTH_URL, exchangeCode, googleConfigured, redirectUri } from "@/server/google/oauth";
import { sessionSecret } from "./secret";

const CODE_TTL_MS = 5 * 60_000;
const REQ_TTL_MS = 15 * 60_000;

export const issuer = () => appUrl();
/** The MCP address users paste into Claude: MCP_URL if set, otherwise APP_URL + /mcp. */
export const resourceUrl = () => process.env.MCP_URL || `${appUrl()}/mcp`;
/** Where /mcp's 401 points clients (the path-suffixed form of RFC 9728). */
export const resourceMetadataUrl = () => `${issuer()}/.well-known/oauth-protected-resource${new URL(resourceUrl()).pathname.replace(/\/$/, "")}`;

// ---------- sealing ----------

type Sealed =
  | { t: "client"; r: string[]; n?: string }
  /** A checked authorize request waiting on /connect: client, redirect URI, PKCE challenge, state, client name, expiry. */
  | { t: "req"; c: string; r: string; p: string; s: string; n?: string; e: number }
  /** Approved: who (users doc id) and which artist. The key is minted when Claude redeems it. */
  | { t: "code"; u: string; a: string; n?: string; c: string; r: string; p: string; e: number }
  | { t: "refresh"; k: string; c: string }
  /** Google sign-in in progress for /connect: the sealed req to come back to. */
  | { t: "login"; q: string; e: number }
  /** Who Google said signed in (users doc id, or none when no live user has that email), for /connect to show. */
  | { t: "who"; u?: string; m: string; h: string; e: number };

const aesKey = () => createHash("sha256").update(`roadie-mcp-oauth:${sessionSecret()}`).digest();

export function seal(v: Sealed): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", aesKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(v), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

export function unseal<T extends Sealed["t"]>(s: string | null | undefined, t: T): Extract<Sealed, { t: T }> | undefined {
  if (!s) return undefined;
  try {
    const b = Buffer.from(s, "base64url");
    if (b.length < 29) return undefined;
    const d = createDecipheriv("aes-256-gcm", aesKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const v = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"));
    return v?.t === t ? v : undefined;
  } catch {
    return undefined;
  }
}

// ---------- responses ----------

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version" };
const json = (status: number, body: unknown, headers: Record<string, string> = CORS) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const oauthError = (status: number, error: string, description: string) => json(status, { error, error_description: description });
export const preflight = () => new Response(null, { status: 204, headers: CORS });

// ---------- metadata ----------

export const protectedResourceMetadata = () =>
  json(200, { resource: resourceUrl(), authorization_servers: [issuer()], bearer_methods_supported: ["header"], resource_name: "Roadie" });

export const authorizationServerMetadata = () =>
  json(200, {
    issuer: issuer(),
    authorization_endpoint: `${issuer()}/oauth/authorize`,
    token_endpoint: `${issuer()}/oauth/token`,
    registration_endpoint: `${issuer()}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["roadie"],
  });

// ---------- dynamic client registration (RFC 7591) ----------

const okRedirect = (u: unknown): u is string => {
  if (typeof u !== "string") return false;
  try {
    const x = new URL(u);
    if (x.hash) return false;
    if (x.protocol === "https:") return true;
    if (x.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname);
    // Native apps register a private-use scheme (com.example.app:/callback); never javascript:, data: and the like.
    return /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/i.test(x.protocol);
  } catch {
    return false;
  }
};

export async function register(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return oauthError(400, "invalid_client_metadata", "Body must be JSON"); }
  const uris = body?.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || !uris.every(okRedirect)) return oauthError(400, "invalid_redirect_uri", "redirect_uris must be https (or http on localhost) URLs");
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 100) : undefined;
  const client_id = seal({ t: "client", r: uris, ...(name ? { n: name } : {}) });
  return json(201, {
    client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: uris,
    ...(name ? { client_name: name } : {}),
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}

// ---------- authorize ----------

/** Checks the request. Errors that must not be sent to the redirect URI (bad client or URI) come back as a page. */
function readAuthParams(p: URLSearchParams): { ok: Extract<Sealed, { t: "req" }> } | { page: string } | { redirect: string } {
  const get = (k: string) => p.get(k) ?? "";
  const client = unseal(get("client_id"), "client");
  if (!client) return { page: "This sign-in link isn't from a client Roadie knows. Remove the connector in Claude and add it again." };
  const redirect_uri = get("redirect_uri") || (client.r.length === 1 ? client.r[0] : "");
  if (!client.r.includes(redirect_uri)) return { page: "This sign-in link has a return address Roadie doesn't recognise." };
  const state = get("state");
  const fail = (error: string, description: string) => ({ redirect: withParams(redirect_uri, { error, error_description: description, state }) });
  if (get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");
  const code_challenge = get("code_challenge");
  if (!code_challenge || (get("code_challenge_method") || "plain") !== "S256") return fail("invalid_request", "PKCE with S256 is required");
  return { ok: { t: "req", c: get("client_id"), r: redirect_uri, p: code_challenge, s: state, ...(client.n ? { n: client.n } : {}), e: Date.now() + REQ_TTL_MS } };
}

const withParams = (base: string, params: Record<string, string>) => {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
};
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });

/** GET /oauth/authorize: check the request, then hand the person to /connect (the app's sign-in) with it sealed. */
export async function authorize(req: Request): Promise<Response> {
  const r = readAuthParams(new URL(req.url).searchParams);
  if ("page" in r) return html(400, errorPage(r.page));
  if ("redirect" in r) return redirect(r.redirect);
  return redirect(signInUrl(seal(r.ok)));
}

/**
 * Where the person signs in. With Google OAuth configured (production): Google's own page, by plain redirects, then
 * /api/google/callback (googleCallback below) -> /connect. No popup and no Firebase in the browser: in Claude's in-app
 * sign-in window on iPhone, Firebase's popup never reports back and its sign-in state can take seconds to load.
 * Without it (dev, tests): /connect, which signs in with Firebase (the emulator's dev buttons).
 */
function signInUrl(sealedReq: string, hint?: string): string {
  if (!googleConfigured()) return `${issuer()}/connect?req=${sealedReq}`;
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!, redirect_uri: redirectUri(), response_type: "code", scope: "openid email",
    prompt: "select_account", state: seal({ t: "login", q: sealedReq, e: Date.now() + REQ_TTL_MS }), ...(hint ? { login_hint: hint } : {}),
  });
  return `${AUTH_URL}?${q}`;
}

/** Binds a sign-in to the one request it was made for, so a `who` can't be paired with someone else's request. */
const reqHash = (sealedReq: string) => createHash("sha256").update(sealedReq).digest("base64url").slice(0, 22);

/** GET /oauth/login?req=: sign in again (another account) for a pending request. */
export async function login(req: Request): Promise<Response> {
  const sealedReq = new URL(req.url).searchParams.get("req") ?? "";
  const r = unseal(sealedReq, "req");
  if (!r || r.e < Date.now()) return html(400, errorPage("This sign-in link has expired. Start again from Claude."));
  return redirect(signInUrl(sealedReq));
}

/** Is this Google callback state one of ours (a /connect sign-in) rather than Settings > Google's? */
export const isLoginState = (state: string | null) => !!unseal(state, "login");

/** Google came back from a /connect sign-in: learn the email from the id_token, then go on to /connect. */
export async function googleCallback(q: URLSearchParams): Promise<Response> {
  const st = unseal(q.get("state"), "login");
  if (!st || st.e < Date.now()) return html(400, errorPage("This sign-in link has expired. Start again from Claude."));
  const r = unseal(st.q, "req");
  if (!r) return html(400, errorPage("This sign-in link has expired. Start again from Claude."));
  if (q.get("error")) return redirect(withParams(r.r, { error: "access_denied", error_description: "Google sign-in was cancelled", state: r.s }));
  let claims: { email?: string; email_verified?: boolean };
  try {
    const t = await exchangeCode(q.get("code") ?? "");
    claims = JSON.parse(Buffer.from(t.id_token?.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch (e) {
    console.error(e);
    return html(502, errorPage("Google sign-in didn't finish. Go back to Claude and try again."));
  }
  const email = claims.email?.trim().toLowerCase();
  if (!email || claims.email_verified === false) return html(400, errorPage("Google didn't share a verified email address."));
  const user = (await db.list("users", (x) => x.where("email", "==", email).limit(5))).find((u) => !u.deletedAt);
  const who = seal({ t: "who", ...(user ? { u: user.id } : {}), m: email, h: reqHash(st.q), e: Date.now() + REQ_TTL_MS });
  return redirect(`${issuer()}/connect?${new URLSearchParams({ req: st.q, who })}`);
}

/** Who is signing in on /connect: their Firebase ID token, matched to a users doc by uid, else by verified email. */
async function personFrom(authHeader: string | null, whoSealed: string | undefined, sealedReq: string) {
  if (whoSealed) {
    const w = unseal(whoSealed, "who");
    if (!w || w.e < Date.now() || w.h !== reqHash(sealedReq)) throw new AppError("unauthenticated", "Your sign-in has expired. Sign in again.", 401);
    const u = w.u ? await db.get("users", w.u) : null;
    if (!u || u.deletedAt) throw new AppError("not_invited", `${w.m} isn't on any band in Roadie. Sign in with the Google account Roadie invited.`, 403);
    return u;
  }
  const m = /^Bearer (.+)$/.exec(authHeader ?? "");
  if (!m) throw new AppError("unauthenticated", "Sign in first", 401);
  let decoded;
  try { decoded = await adminAuth().verifyIdToken(m[1]); }
  catch { throw new AppError("unauthenticated", "Your sign-in has expired. Sign in again.", 401); }
  let user = await db.get("users", decoded.uid);
  const email = decoded.email?.trim().toLowerCase();
  if ((!user || user.deletedAt) && email && decoded.email_verified !== false) {
    user = (await db.list("users", (q) => q.where("email", "==", email).limit(5))).find((u) => !u.deletedAt) ?? null;
  }
  if (!user || user.deletedAt) throw new AppError("not_invited", `${decoded.email ?? "This account"} isn't on any band in Roadie.`, 403);
  return user;
}

/**
 * POST /oauth/approve, called by /connect with the person's Firebase ID token. Body `{req}` lists their artists and
 * which have AI access; `{req, artistId}` approves and returns the redirect back to the client with a code;
 * `{req, cancel: true}` returns the access_denied redirect.
 */
/** Same-origin JSON (no CORS): only our own /connect page calls /oauth/approve. */
const own = (status: number, body: unknown) => json(status, body, {});

export async function approve(req: Request): Promise<Response> {
  let body: { req?: string; who?: string; artistId?: string; cancel?: boolean };
  try { body = (await req.json()) as typeof body; }
  catch { return own(400, new AppError("invalid_input", "Body must be JSON").toJSON()); }
  const r = unseal(body.req, "req");
  if (!r || r.e < Date.now()) return own(400, new AppError("expired", "This sign-in link has expired. Start again from Claude.").toJSON());
  if (body.cancel) return own(200, { redirect: withParams(r.r, { error: "access_denied", error_description: "Sign-in was cancelled", state: r.s }) });
  try {
    const user = await personFrom(req.headers.get("authorization"), body.who, body.req!);
    const ms = (user.artists ?? []) as Membership[];
    if (!body.artistId) {
      const docs = await Promise.all(ms.map((m) => db.get("artists", m.artistId)));
      const artists = ms.flatMap((m, i) => {
        const a = docs[i];
        return a && !a.deletedAt ? [{ artistId: m.artistId, name: a.name as string, ai: mcpIn(user, m.artistId) }] : [];
      }).sort((a, b) => a.name.localeCompare(b.name));
      return own(200, { client: r.n ?? "Claude", returnTo: new URL(r.r).host, name: user.name, email: user.email, artists });
    }
    if (!ms.some((m) => m.artistId === body.artistId)) throw new AppError("not_a_member", "You're not a member of this artist", 403);
    if (!mcpIn(user, body.artistId)) throw new AppError("forbidden", "You don't have AI access in this artist. Ask a band admin to turn it on for you in People.", 403);
    const code = seal({ t: "code", u: user.id, a: body.artistId, ...(r.n ? { n: r.n } : {}), c: r.c, r: r.r, p: r.p, e: Date.now() + CODE_TTL_MS });
    return own(200, { redirect: withParams(r.r, { code, state: r.s }) });
  } catch (e) {
    if (e instanceof AppError) return own(e.status, e.toJSON());
    console.error(e);
    return own(500, { error: { code: "internal", message: "Something went wrong" } });
  }
}

// ---------- token ----------

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export async function token(req: Request): Promise<Response> {
  let p: URLSearchParams;
  const type = req.headers.get("content-type") ?? "";
  try {
    p = type.includes("application/json") ? new URLSearchParams((await req.json()) as Record<string, string>) : new URLSearchParams(await req.text());
  } catch {
    return oauthError(400, "invalid_request", "Unreadable body");
  }
  const grant = p.get("grant_type");
  const clientId = p.get("client_id") ?? "";

  let key: string, client: string;
  try {
    if (grant === "authorization_code") {
      const code = unseal(p.get("code"), "code");
      if (!code || code.e < Date.now()) return oauthError(400, "invalid_grant", "The code is invalid or has expired");
      if (clientId && clientId !== code.c) return oauthError(400, "invalid_grant", "The code was issued to another client");
      if ((p.get("redirect_uri") ?? code.r) !== code.r) return oauthError(400, "invalid_grant", "redirect_uri does not match");
      const verifier = p.get("code_verifier");
      if (!verifier || !same(s256(verifier), code.p)) return oauthError(400, "invalid_grant", "PKCE verification failed");
      // Access is checked again here (it may have been turned off in the last five minutes) and the key is made.
      key = await mintKey(code.u, code.a, code.n ?? "Claude");
      client = code.c;
    } else if (grant === "refresh_token") {
      const rt = unseal(p.get("refresh_token"), "refresh");
      if (!rt || (clientId && clientId !== rt.c)) return oauthError(400, "invalid_grant", "The refresh token is invalid");
      key = rt.k;
      client = rt.c;
    } else {
      return oauthError(400, "unsupported_grant_type", "Use authorization_code or refresh_token");
    }
    await authenticateToken(key);
  } catch (e) {
    if (e instanceof AppError) return oauthError(400, "invalid_grant", e.message);
    throw e;
  }
  return json(200, { access_token: key, token_type: "Bearer", scope: "roadie", refresh_token: seal({ t: "refresh", k: key, c: client }) });
}

// ---------- pages ----------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const html = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer" } });

const errorPage = (msg: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Can't connect Roadie</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;font:16px/1.45 system-ui,sans-serif}main{max-width:420px}</style>
</head><body><main><h1>Can't connect Roadie</h1><p>${esc(msg)}</p></main></body></html>`;

/** POST /oauth/log: /connect reports a step that stalled in someone's browser (it runs on their phone, out of sight). */
export async function connectLog(req: Request): Promise<Response> {
  try {
    const b = JSON.parse((await req.text()).slice(0, 1000)) as { step?: unknown; detail?: unknown; ua?: unknown };
    const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n).replace(/[\r\n]/g, " ") : "");
    console.warn(`connect stalled: step=${str(b.step, 40)} detail=${str(b.detail, 200)} ua=${str(b.ua, 200)}`);
  } catch { /* ignore junk */ }
  return new Response(null, { status: 204 });
}
