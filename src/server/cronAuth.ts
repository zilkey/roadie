/**
 * Who may call a scheduled job's route: this repo's own GitHub Actions workflow, on main, with GitHub's OIDC token for the route's
 * URL (docs/designs/venue-refresh.md), or Cloud Scheduler with a Google OIDC token for its service account (scheduled posts). The
 * token is a JWT; we check the signature against GitHub's (or Google's) published keys
 * and the claims (issuer, audience, repository, branch, workflow, expiry). No shared secret anywhere: nothing to set or leak.
 */
import { createPublicKey, verify, type webcrypto } from "node:crypto";

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
type Jwk = webcrypto.JsonWebKey & { kid?: string };
type Keys = () => Promise<Jwk[]>;

/** A JWKS URL's keys, kept for an hour. */
function jwks(url: string): Keys {
  let cached: { at: number; keys: Jwk[] } | undefined;
  return async () => {
    if (cached && Date.now() - cached.at < 3_600_000) return cached.keys;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`jwks ${r.status}`);
    cached = { at: Date.now(), keys: ((await r.json()) as { keys: Jwk[] }).keys };
    return cached.keys;
  };
}
const githubKeys = jwks(`${GITHUB_ISSUER}/.well-known/jwks`);
const googleKeys = jwks("https://www.googleapis.com/oauth2/v3/certs");

const b64 = (s: string) => Buffer.from(s, "base64url");

/** The claims of `req`'s Bearer JWT once its RS256 signature checks out against `keys` and it's in date for `audience`; else null. */
async function verifiedClaims(req: Request, audience: string, keys: Keys, now?: Date): Promise<Record<string, unknown> | null> {
  const m = /^Bearer\s+([\w-]+)\.([\w-]+)\.([\w-]+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  try {
    const header = JSON.parse(b64(m[1]).toString()) as { alg?: string; kid?: string };
    if (header.alg !== "RS256") return null;
    const jwk = (await keys()).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = createPublicKey({ key: jwk, format: "jwk" });
    if (!verify("RSA-SHA256", Buffer.from(`${m[1]}.${m[2]}`), key, b64(m[3]))) return null;
    const c = JSON.parse(b64(m[2]).toString()) as Record<string, unknown>;
    const t = (now ?? new Date()).getTime() / 1000;
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    return aud.includes(audience) && Number(c.exp) > t && Number(c.nbf ?? 0) <= t + 60 ? c : null;
  } catch {
    return null;
  }
}

export interface CronCaller { repository: string; workflow: string }

/**
 * True when `req` carries a valid GitHub Actions OIDC token from `caller.repository`'s `caller.workflow` (a file name under
 * .github/workflows) on refs/heads/main, issued for `audience`. Repository unset (CRON_GITHUB_REPO): every call is refused.
 */
export async function cronAllowed(req: Request, audience: string, caller: Partial<CronCaller>, opts: { keys?: Keys; now?: Date } = {}): Promise<boolean> {
  if (!caller.repository || !caller.workflow) return false;
  const c = await verifiedClaims(req, audience, opts.keys ?? githubKeys, opts.now);
  return !!c && c.iss === GITHUB_ISSUER
    && c.repository === caller.repository && c.ref === "refs/heads/main"
    && String(c.workflow_ref ?? "").startsWith(`${caller.repository}/.github/workflows/${caller.workflow}@`);
}

/**
 * True when `req` carries a Google-signed OIDC token for `audience` whose caller is the service account `serviceAccount`: how
 * Cloud Scheduler calls a job's URL (its job is set up with that account). Account unset (CRON_SCHEDULER_SA): every call is refused.
 */
export async function schedulerAllowed(req: Request, audience: string, serviceAccount: string | undefined, opts: { keys?: Keys; now?: Date } = {}): Promise<boolean> {
  if (!serviceAccount) return false;
  const c = await verifiedClaims(req, audience, opts.keys ?? googleKeys, opts.now);
  return !!c && (c.iss === "https://accounts.google.com" || c.iss === "accounts.google.com")
    && c.email === serviceAccount && c.email_verified === true;
}
