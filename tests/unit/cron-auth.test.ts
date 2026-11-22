// The scheduled-job route's caller check (src/server/cronAuth.ts): this repo's workflow, on main, by GitHub's OIDC token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { cronAllowed, GITHUB_ISSUER } from "@/server/cronAuth";

const AUD = "https://app.example.test/api/cron/venue-calendars";
const CALLER = { repository: "band/roadie", workflow: "venue-calendars.yml" };
const NOW = new Date("2026-11-22T08:00:00Z");
const t = NOW.getTime() / 1000;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keys = async () => [{ ...publicKey.export({ format: "jwk" }), kid: "k1" }];
const claims = { iss: GITHUB_ISSUER, aud: AUD, repository: "band/roadie", ref: "refs/heads/main", workflow_ref: "band/roadie/.github/workflows/venue-calendars.yml@refs/heads/main", exp: t + 300, nbf: t - 10 };
const jwt = (c: Record<string, unknown> = claims, key = privateKey, kid = "k1", alg = "RS256") => {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${part({ alg, kid, typ: "JWT" })}.${part(c)}`;
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), key).toString("base64url")}`;
};
const call = (auth: string | undefined, caller: Partial<typeof CALLER> = CALLER) =>
  cronAllowed(new Request(AUD, { method: "POST", headers: auth ? { authorization: auth } : {} }), AUD, caller, { keys, now: NOW });

test("the workflow's token gets in", async () => assert.equal(await call(`Bearer ${jwt()}`), true));
test("no token, another scheme, garbage, or no CRON_GITHUB_REPO: refused", async () => {
  assert.equal(await call(undefined), false);
  assert.equal(await call(`Basic ${jwt()}`), false);
  assert.equal(await call("Bearer a.b.c"), false);
  assert.equal(await call(`Bearer ${jwt()}`, { workflow: CALLER.workflow }), false);
});
test("signed by another key, an unknown kid or another alg: refused", async () => {
  assert.equal(await call(`Bearer ${jwt(claims, other.privateKey)}`), false);
  assert.equal(await call(`Bearer ${jwt(claims, privateKey, "k2")}`), false);
  assert.equal(await call(`Bearer ${jwt(claims, privateKey, "k1", "HS256")}`), false);
});
test("wrong issuer, audience, repo, branch, workflow, or expired: refused", async () => {
  for (const bad of [{ iss: "https://evil.example" }, { aud: "https://elsewhere.example/" }, { repository: "someone/fork" }, { ref: "refs/heads/feature" },
    { workflow_ref: "band/roadie/.github/workflows/other.yml@refs/heads/main" }, { exp: t - 1 }]) {
    assert.equal(await call(`Bearer ${jwt({ ...claims, ...bad })}`), false, JSON.stringify(bad));
  }
});
