/**
 * OAuth for the MCP server, so Claude's "Add custom connector" (claude.ai, desktop and mobile apps) can sign in. Those
 * clients don't take a pasted header: on a 401 from /mcp they read the protected-resource metadata, then the
 * authorization-server metadata, register themselves (RFC 7591) and run authorization code + PKCE. Without these
 * endpoints the app says "Couldn't start sign-in".
 *
 * Signing in still means pasting your Roadie key (btk_...) on our authorize page, and the access token Claude gets back
 * *is* that key, so /mcp's bearer check, revocation and lastUsedAt work exactly as with Claude Code's header.
 *
 * Stateless like mcp/web.ts (App Hosting scales to zero, up to two instances): client ids, codes and refresh tokens are
 * sealed (AES-256-GCM) with a key derived from MCP_SESSION_SECRET, so any instance can open them and nothing is stored.
 * Codes expire after five minutes and are bound to the client, the redirect URI and the PKCE challenge.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appUrl } from "@/lib/app-url";
import { AppError } from "@/server/errors";
import { authenticateToken } from "./auth";
import { sessionSecret } from "./secret";

const CODE_TTL_MS = 5 * 60_000;

export const issuer = () => appUrl();
/** The MCP address users paste into Claude: MCP_URL if set, otherwise APP_URL + /mcp. */
export const resourceUrl = () => process.env.MCP_URL || `${appUrl()}/mcp`;
/** Where /mcp's 401 points clients (the path-suffixed form of RFC 9728). */
export const resourceMetadataUrl = () => `${issuer()}/.well-known/oauth-protected-resource${new URL(resourceUrl()).pathname.replace(/\/$/, "")}`;

// ---------- sealing ----------

type Sealed =
  | { t: "client"; r: string[]; n?: string }
  | { t: "code"; k: string; c: string; r: string; p: string; e: number }
  | { t: "refresh"; k: string; c: string };

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
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...headers } });
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

interface AuthParams { client_id: string; redirect_uri: string; code_challenge: string; state: string; clientName?: string }

/** Checks the request. Errors that must not be sent to the redirect URI (bad client or URI) come back as a page. */
function readAuthParams(p: URLSearchParams | FormData): { ok: AuthParams } | { page: string } | { redirect: string } {
  const get = (k: string) => { const v = p.get(k); return typeof v === "string" ? v : ""; };
  const client = unseal(get("client_id"), "client");
  if (!client) return { page: "This sign-in link isn't from a client Roadie knows. Remove the connector in Claude and add it again." };
  const redirect_uri = get("redirect_uri") || (client.r.length === 1 ? client.r[0] : "");
  if (!client.r.includes(redirect_uri)) return { page: "This sign-in link has a return address Roadie doesn't recognise." };
  const state = get("state");
  const fail = (error: string, description: string) => ({ redirect: withParams(redirect_uri, { error, error_description: description, state }) });
  if (get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");
  const code_challenge = get("code_challenge");
  if (!code_challenge || (get("code_challenge_method") || "plain") !== "S256") return fail("invalid_request", "PKCE with S256 is required");
  return { ok: { client_id: get("client_id"), redirect_uri, code_challenge, state, clientName: client.n } };
}

const withParams = (base: string, params: Record<string, string>) => {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
};
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });

export async function authorize(req: Request): Promise<Response> {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const r = readAuthParams(url.searchParams);
    if ("page" in r) return html(400, errorPage(r.page));
    if ("redirect" in r) return redirect(r.redirect);
    return html(200, signInPage(url.searchParams, r.ok.clientName));
  }

  const form = await req.formData();
  const r = readAuthParams(form);
  if ("page" in r) return html(400, errorPage(r.page));
  if ("redirect" in r) return redirect(r.redirect);
  const { client_id, redirect_uri, code_challenge, state } = r.ok;
  if (form.get("cancel")) return redirect(withParams(redirect_uri, { error: "access_denied", error_description: "Sign-in was cancelled", state }));

  const key = String(form.get("key") ?? "").trim();
  try {
    await authenticateToken(key);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    const msg = e.status === 401 ? (e.message === "This token was revoked" ? "That key was switched off. Ask a band admin for a new one." : "That key didn't work. Check you copied all of it.") : e.message;
    return html(e.status === 401 ? 401 : 403, signInPage(form, r.ok.clientName, msg));
  }
  const code = seal({ t: "code", k: key, c: client_id, r: redirect_uri, p: code_challenge, e: Date.now() + CODE_TTL_MS });
  return redirect(withParams(redirect_uri, { code, state }));
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
  if (grant === "authorization_code") {
    const code = unseal(p.get("code"), "code");
    if (!code || code.e < Date.now()) return oauthError(400, "invalid_grant", "The code is invalid or has expired");
    if (clientId && clientId !== code.c) return oauthError(400, "invalid_grant", "The code was issued to another client");
    if ((p.get("redirect_uri") ?? code.r) !== code.r) return oauthError(400, "invalid_grant", "redirect_uri does not match");
    const verifier = p.get("code_verifier");
    if (!verifier || !same(s256(verifier), code.p)) return oauthError(400, "invalid_grant", "PKCE verification failed");
    key = code.k;
    client = code.c;
  } else if (grant === "refresh_token") {
    const rt = unseal(p.get("refresh_token"), "refresh");
    if (!rt || (clientId && clientId !== rt.c)) return oauthError(400, "invalid_grant", "The refresh token is invalid");
    key = rt.k;
    client = rt.c;
  } else {
    return oauthError(400, "unsupported_grant_type", "Use authorization_code or refresh_token");
  }

  try {
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

const shell = (title: string, inner: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #f7f5f2; --card: #fff; --fg: #1d1b19; --muted: #6b6560; --line: #e2ddd6; --accent: #c2410c; --err: #b91c1c; }
  @media (prefers-color-scheme: dark) { :root { --bg: #151413; --card: #1f1d1b; --fg: #f2efeb; --muted: #a39d96; --line: #34302c; --accent: #fb923c; --err: #f87171; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--fg); font: 16px/1.45 system-ui, -apple-system, sans-serif; }
  main { width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 24px; display: grid; gap: 14px; }
  h1 { margin: 0; font-size: 1.35rem; }
  p { margin: 0; color: var(--muted); }
  label { display: grid; gap: 6px; font-weight: 600; }
  input[type=password] { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); font: 15px ui-monospace, monospace; }
  .row { display: flex; gap: 10px; }
  button { flex: 1; padding: 12px; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: var(--fg); font: 600 15px system-ui, sans-serif; cursor: pointer; }
  button.go { background: var(--accent); border-color: var(--accent); color: #fff; }
  .err { color: var(--err); font-weight: 600; }
</style></head><body><main>${inner}</main></body></html>`;

function signInPage(p: URLSearchParams | FormData, clientName?: string, error?: string) {
  const keep = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"];
  const hidden = keep.map((k) => { const v = p.get(k); return typeof v === "string" && v ? `<input type="hidden" name="${k}" value="${esc(v)}">` : ""; }).join("");
  const who = clientName ? esc(clientName) : "Claude";
  return shell("Connect Roadie", `
<h1>Connect Roadie to ${who}</h1>
<p>Paste your Roadie key. It starts with <code>btk_</code>; a band admin gives it to you from Admin &gt; AI keys.</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
<form method="post" action="/oauth/authorize" style="display:grid;gap:14px">
  ${hidden}
  <label>Roadie key<input type="password" name="key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="btk_..." required autofocus></label>
  <div class="row"><button type="submit" name="cancel" value="1" formnovalidate>Cancel</button><button class="go" type="submit">Connect</button></div>
</form>
<p>${who} will act as you in Roadie. Everything it changes shows in History, and a band admin can switch the key off at any time.</p>`);
}

const errorPage = (msg: string) => shell("Can't connect Roadie", `<h1>Can't connect Roadie</h1><p class="err">${esc(msg)}</p>`);
