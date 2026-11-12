import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { dispatch } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { gmailClient } from "@/server/integrations/gmail";
import { FEATURE_SCOPES, TOKEN_URL, REVOKE_URL } from "@/server/google/oauth";
import { accessTokenForEmail, saveGrant } from "@/server/google/grants";
import { resetEmulators, makeUser, makeArtist, venue, TEST_ARTIST } from "./helpers";

// ---------- a stub for Google's HTTP APIs; everything else (the emulators) passes through ----------

interface Seen { method: string; url: URL; body: unknown; auth: string | null }
type Handler = (s: Seen) => { status?: number; json?: unknown } | undefined;
const realFetch = globalThis.fetch;
let seen: Seen[] = [];
let handler: Handler = () => undefined;

function stubGoogle(h: Handler) {
  seen = [];
  handler = h;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!/googleapis\.com$|accounts\.google\.com$/.test(url.hostname)) return realFetch(input, init);
    const raw = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : undefined;
    let body: unknown = raw;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { /* form body */ }
    const s: Seen = { method: init?.method ?? "GET", url, body, auth: new Headers(init?.headers).get("authorization") };
    seen.push(s);
    const r = handler(s) ?? { status: 404, json: { error: { code: 404, message: "Not found" } } };
    return new Response(r.json === undefined ? "" : JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
afterEach(() => { globalThis.fetch = realFetch; });

const ENV = { GOOGLE_OAUTH_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_OAUTH_CLIENT_SECRET: "shh", GOOGLE_TOKEN_KEY: randomBytes(32).toString("base64") };
function withGoogleEnv() {
  const was = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV);
  return () => { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
}
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

test("email.signature: the sanitized Gmail signature, and null when Gmail refuses (403) or isn't connected", async () => {
  const restore = withGoogleEnv();
  const gmailWas = process.env.GMAIL_BASE_URL;
  try {
    delete process.env.GMAIL_BASE_URL;
    await makeArtist("Nora Quill Band", "iab");
    const rudy = await makeUser("rudy@example.com", "admin");
    const member = await makeUser("hugo@example.com", "member");
    assert.equal((await dispatch("email.signature", bearer(member.token), {})).status, 403, "admins only");
    const ask = async () => (await dispatch("email.signature", bearer(rudy.token), {})).json as { result: { html: string; text: string } | null };
    assert.equal((await ask()).result, null, "no grant yet");

    await saveGrant(rudy.uid, "rudy@example.com", "rudy@example.com", { access_token: "at-1", expires_in: 3600, refresh_token: "1//rt", scope: ["openid", ...FEATURE_SCOPES.gmail].join(" ") });
    stubGoogle(() => ({ json: { sendAs: [{ sendAsEmail: "rudy@example.com", isPrimary: true, signature: '<div dir="ltr">Rudy<br><a href="javascript:alert(1)" onclick="x()">site</a> <a href="https://band.example">band</a><script>bad()</script></div>' }] } }));
    const ok = (await ask()).result!;
    assert.equal(ok.html, '<div>Rudy<br>site <a href="https://band.example" rel="noopener">band</a></div>');
    assert.equal(ok.text, "Rudy\nsite band (https://band.example)");
    assert.equal(seen[0].auth, "Bearer at-1");

    stubGoogle(() => ({ status: 403, json: { error: { code: 403, message: "Request had insufficient authentication scopes." } } }));
    assert.equal((await ask()).result, null);
    stubGoogle(() => ({ status: 500, json: { error: { code: 500, message: "boom" } } }));
    assert.equal((await dispatch("email.signature", bearer(rudy.token), {})).status, 500, "other failures are errors, not null");
  } finally {
    restore();
    if (gmailWas === undefined) delete process.env.GMAIL_BASE_URL; else process.env.GMAIL_BASE_URL = gmailWas;
  }
});

// ---------- connecting (commands, against the emulators) ----------

const bearer = (t: string) => `Bearer ${t}`;
const idToken = (email: string) => `x.${b64(JSON.stringify({ email }))}.y`;

beforeEach(resetEmulators);

test("google.status says when Google isn't set up", async () => {
  const rudy = await makeUser("rudy@example.com", "admin");
  const r = await dispatch("google.status", bearer(rudy.token), {});
  const st = (r.json as { result: { configured: boolean; me: unknown; band: unknown; bandFolder: unknown } }).result;
  assert.deepEqual([st.configured, st.me, st.band, st.bandFolder], [false, null, null, null]);
  assert.equal((await dispatch("google.connectUrl", bearer(rudy.token), { features: ["gmail"] })).status, 503);
});

test("connect: consent URL, finish only for the admin who started it, band account, real Gmail, disconnect", async () => {
  const restore = withGoogleEnv();
  const gmailWas = process.env.GMAIL_BASE_URL;
  try {
    await makeArtist("Nora Quill Band", "iab");
    const rudy = await makeUser("rudy@example.com", "admin");
    const nora = await makeUser("nora@example.com", "admin");
    const member = await makeUser("hugo@example.com", "member");
    assert.equal((await dispatch("google.status", bearer(member.token), {})).status, 403, "admins only");

    const r = await dispatch("google.connectUrl", bearer(rudy.token), { features: ["gmail", "calendar"] });
    const url = new URL((r.json as { result: { url: string } }).result.url);
    assert.match(url.searchParams.get("redirect_uri")!, /^http.*\/api\/google\/callback$/);
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("login_hint"), "rudy@example.com");
    assert.deepEqual(url.searchParams.get("scope")!.split(" "), ["openid", "email", ...FEATURE_SCOPES.gmail, ...FEATURE_SCOPES.calendar]);
    const state = url.searchParams.get("state")!;

    stubGoogle((s) => {
      if (s.url.href === TOKEN_URL && new URLSearchParams(s.body as string).get("grant_type") === "authorization_code") {
        return { json: { access_token: "at-1", expires_in: 3600, refresh_token: "1//rt", scope: ["openid", ...FEATURE_SCOPES.gmail, ...FEATURE_SCOPES.calendar].join(" "), id_token: idToken("Rudy.Pike@example.com") } };
      }
      if (s.url.pathname.endsWith("/messages/send")) return { json: { id: "m1", threadId: "t1" } };
      if (s.url.href.startsWith(REVOKE_URL)) return { json: {} };
    });
    assert.equal((await dispatch("google.finishConnect", bearer(nora.token), { code: "c", state })).status, 400, "someone else's state is refused");
    const done = await dispatch("google.finishConnect", bearer(rudy.token), { code: "c", state });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    const st = (done.json as { result: { me: unknown; band: { email: string; isMe: boolean }; missing: string[] } }).result;
    assert.deepEqual(st.me, { googleEmail: "rudy.pike@example.com", features: ["gmail", "calendar"] });
    assert.deepEqual([st.band.email, st.band.isMe, st.missing], ["rudy.pike@example.com", true, []]);
    assert.deepEqual((await db.get("artists", TEST_ARTIST))?.google, { uid: rudy.uid, email: "rudy.pike@example.com" });

    // Gmail goes real once Google is configured and GMAIL_BASE_URL is unset, sending with Rudy's own grant.
    delete process.env.GMAIL_BASE_URL;
    await gmailClient().send({ account: "rudy@example.com", to: ["a@b.com"], subject: "Hi", body: "b" });
    assert.equal(seen.find((s) => s.url.pathname.endsWith("/messages/send"))?.auth, "Bearer at-1");
    await assert.rejects(accessTokenForEmail("nora@example.com", "gmail"), /hasn't connected Google/);

    const off = await dispatch("google.disconnect", bearer(rudy.token), {});
    assert.equal(off.status, 200);
    assert.ok(seen.some((s) => s.url.href.startsWith(REVOKE_URL) && s.url.searchParams.get("token") === "1//rt"), "revoked at Google");
    assert.ok(!(await db.get("artists", TEST_ARTIST))?.google, "the band has no Google account now");
    const after = (off.json as { result: { configured: boolean; me: unknown; band: unknown } }).result;
    assert.deepEqual([after.configured, after.me, after.band], [true, null, null]);
  } finally {
    restore();
    if (gmailWas === undefined) delete process.env.GMAIL_BASE_URL; else process.env.GMAIL_BASE_URL = gmailWas;
  }
});

test("booking mailbox: only an admin with Gmail sets it, to themself; another takes over; only its owner clears it; disconnect clears it; sends use its token", async () => {
  const restore = withGoogleEnv();
  const gmailWas = process.env.GMAIL_BASE_URL;
  try {
    delete process.env.GMAIL_BASE_URL;
    await makeArtist("Nora Quill Band", "iab");
    const ingrid = await makeUser("ingrid@example.com", "admin", { name: "Ingrid" });
    const rudy = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
    const member = await makeUser("hugo@example.com", "member");
    const grant = (uid: string, email: string, features: (keyof typeof FEATURE_SCOPES)[], token: string) =>
      saveGrant(uid, email, email, { access_token: token, expires_in: 3600, refresh_token: `1//${token}`, scope: ["openid", ...features.flatMap((f) => FEATURE_SCOPES[f])].join(" ") });
    const mailbox = async () => (await db.get("artists", TEST_ARTIST))?.bookingMail ?? null;
    type St = { bookingMail: { email: string; name: string; isMe: boolean; gmail: boolean } | null };
    const use = (t: string) => dispatch("google.useForBookingMail", bearer(t), {});
    const clear = (t: string) => dispatch("google.clearBookingMail", bearer(t), {});

    assert.equal((await use(member.token)).status, 403, "admins only");
    assert.equal((await use(ingrid.token)).status, 400, "no Gmail connected yet");
    await grant(ingrid.uid, "ingrid@example.com", ["calendar"], "at-i0");
    assert.equal((await use(ingrid.token)).status, 400, "Calendar alone isn't Gmail");
    assert.equal(await mailbox(), null);

    await grant(ingrid.uid, "ingrid@example.com", ["gmail", "calendar"], "at-ingrid");
    const set = await use(ingrid.token);
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.deepEqual((set.json as { result: St }).result.bookingMail, { email: "ingrid@example.com", name: "Ingrid", isMe: true, gmail: true });
    assert.deepEqual(await mailbox(), { uid: ingrid.uid, email: "ingrid@example.com" });
    const seenByRudy = (await dispatch("google.status", bearer(rudy.token), {})).json as { result: St };
    assert.equal(seenByRudy.result.bookingMail?.isMe, false);

    // Rudy has no Gmail of his own: his sends, drafts and signature go through Ingrid's grant.
    stubGoogle((s) => {
      if (s.url.pathname.endsWith("/messages/send")) return { json: { id: "m1", threadId: "t1" } };
      if (s.url.pathname.endsWith("/drafts")) return { json: { id: "d1", message: { id: "m2", threadId: "t2" } } };
      if (s.url.pathname.includes("/threads/")) return { json: { id: "t1", messages: [] } };
      if (s.url.href.startsWith(REVOKE_URL)) return { json: {} };
    });
    const v = await dispatch("venues.create", bearer(rudy.token), venue("Pine Hollow"));
    assert.equal(v.status, 200, JSON.stringify(v.json));
    const target = { kind: "venue", id: (v.json as { result: { id: string } }).result.id };
    const sent = await dispatch("email.send", bearer(rudy.token), { target, to: ["rosa@pinehollow.example"], subject: "Hi", body: "Hello" });
    assert.equal(sent.status, 200, JSON.stringify(sent.json));
    assert.equal(seen.find((s) => s.url.pathname.endsWith("/messages/send"))?.auth, "Bearer at-ingrid");
    const t = await db.get("emailThreads", `${TEST_ARTIST}__t1`);
    assert.equal(t?.account, "ingrid@example.com");
    assert.deepEqual(t?.sentBy, { m1: rudy.uid }, "who wrote it");
    assert.equal((await dispatch("email.draft", bearer(rudy.token), { target, to: ["rosa@pinehollow.example"], subject: "Hi", body: "Hello" })).status, 200);
    assert.equal(seen.find((s) => s.url.pathname.endsWith("/drafts"))?.auth, "Bearer at-ingrid", "the draft lands in Ingrid's Gmail");

    // Rudy can't clear or claim it for Ingrid; he can only take it over with his own Gmail.
    assert.equal((await clear(rudy.token)).status, 403, "only the owner clears it");
    assert.equal((await use(rudy.token)).status, 400, "taking over needs your own Gmail");
    await grant(rudy.uid, "rudy@example.com", ["gmail"], "at-rudy");
    assert.equal((await use(rudy.token)).status, 200);
    assert.deepEqual(await mailbox(), { uid: rudy.uid, email: "rudy@example.com" }, "taken over");
    assert.equal((await clear(ingrid.token)).status, 403, "no longer Ingrid's to clear");
    assert.equal((await clear(rudy.token)).status, 200);
    assert.equal(await mailbox(), null);

    // Disconnecting the owner's Google clears it.
    assert.equal((await use(ingrid.token)).status, 200);
    assert.equal((await dispatch("google.disconnect", bearer(rudy.token), {})).status, 200);
    assert.equal((await mailbox())?.uid, ingrid.uid, "someone else disconnecting leaves it");
    assert.equal((await dispatch("google.disconnect", bearer(ingrid.token), {})).status, 200);
    assert.equal(await mailbox(), null);
  } finally {
    restore();
    if (gmailWas === undefined) delete process.env.GMAIL_BASE_URL; else process.env.GMAIL_BASE_URL = gmailWas;
  }
});
