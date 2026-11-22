/**
 * Who may call a scheduled job's route: this repo's own GitHub Actions workflow, on main, with GitHub's OIDC token for the route's
 * URL (docs/designs/venue-refresh.md). The token is a JWT signed by GitHub; we check the signature against GitHub's published keys
 * and the claims (issuer, audience, repository, branch, workflow, expiry). No shared secret anywhere: nothing to set or leak.
 */
import { createPublicKey, verify, type webcrypto } from "node:crypto";

export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
type Jwk = webcrypto.JsonWebKey & { kid?: string };
type Keys = () => Promise<Jwk[]>;

let cached: { at: number; keys: Jwk[] } | undefined;
/** GitHub's signing keys, kept for an hour. */
const githubKeys: Keys = async () => {
  if (cached && Date.now() - cached.at < 3_600_000) return cached.keys;
  const r = await fetch(`${GITHUB_ISSUER}/.well-known/jwks`, { cache: "no-store" });
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  cached = { at: Date.now(), keys: ((await r.json()) as { keys: Jwk[] }).keys };
  return cached.keys;
};

const b64 = (s: string) => Buffer.from(s, "base64url");

export interface CronCaller { repository: string; workflow: string }

/**
 * True when `req` carries a valid GitHub Actions OIDC token from `caller.repository`'s `caller.workflow` (a file name under
 * .github/workflows) on refs/heads/main, issued for `audience`. Repository unset (CRON_GITHUB_REPO): every call is refused.
 */
export async function cronAllowed(req: Request, audience: string, caller: Partial<CronCaller>, opts: { keys?: Keys; now?: Date } = {}): Promise<boolean> {
  const m = /^Bearer\s+([\w-]+)\.([\w-]+)\.([\w-]+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!caller.repository || !caller.workflow || !m) return false;
  try {
    const header = JSON.parse(b64(m[1]).toString()) as { alg?: string; kid?: string };
    if (header.alg !== "RS256") return false;
    const jwk = (await (opts.keys ?? githubKeys)()).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = createPublicKey({ key: jwk, format: "jwk" });
    if (!verify("RSA-SHA256", Buffer.from(`${m[1]}.${m[2]}`), key, b64(m[3]))) return false;
    const c = JSON.parse(b64(m[2]).toString()) as Record<string, unknown>;
    const now = (opts.now ?? new Date()).getTime() / 1000;
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    return c.iss === GITHUB_ISSUER && aud.includes(audience)
      && c.repository === caller.repository && c.ref === "refs/heads/main"
      && String(c.workflow_ref ?? "").startsWith(`${caller.repository}/.github/workflows/${caller.workflow}@`)
      && Number(c.exp) > now && Number(c.nbf ?? 0) <= now + 60;
  } catch {
    return false;
  }
}
