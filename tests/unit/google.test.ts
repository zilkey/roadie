import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { dispatch } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { googleGmail, rawMessage, gmailClient } from "@/server/integrations/gmail";
import { googleDrive } from "@/server/integrations/drive";
import { googleCalendar } from "@/server/integrations/calendar";
import { IntegrationError } from "@/server/integrations";
import { signState, verifyState, featuresOf, FEATURE_SCOPES, TOKEN_URL, REVOKE_URL } from "@/server/google/oauth";
import { seal, unseal, accessTokenForEmail } from "@/server/google/grants";
import { missingFor } from "@/server/music";
import { resetEmulators, makeUser, makeArtist, TEST_ARTIST } from "./helpers";

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
const token = async () => "tok";

// ---------- oauth + grants ----------

test("state: signed, bound to its contents, expires", () => {
  const restore = withGoogleEnv();
  try {
    const st = signState({ uid: "u1", artistId: "a1", slug: "band", features: ["gmail"] });
    assert.equal(verifyState(st)?.uid, "u1");
    const [body, mac] = st.split(".");
    const forged = b64(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), uid: "attacker" }));
    assert.equal(verifyState(`${forged}.${mac}`), null, "changed contents fail the signature");
    assert.equal(verifyState(st, Date.now() + 60 * 60_000), null, "expired");
    assert.equal(verifyState("garbage"), null);
  } finally { restore(); }
});

test("refresh tokens are sealed with AES-GCM; features need every scope", () => {
  const restore = withGoogleEnv();
  try {
    const s = seal("1//refresh");
    assert.ok(!s.includes("refresh"));
    assert.equal(unseal(s), "1//refresh");
    const parts = s.split(":"); parts[3] = Buffer.from("tampered").toString("base64");
    assert.throws(() => unseal(parts.join(":")));
    assert.deepEqual(featuresOf([...FEATURE_SCOPES.gmail, ...FEATURE_SCOPES.drive]), ["gmail", "drive"]);
    assert.deepEqual(featuresOf([FEATURE_SCOPES.gmail[0]]), []);
  } finally { restore(); }
});

// ---------- Gmail API ----------

test("gmail: send builds a text/plain RFC 2822 message; replies carry In-Reply-To and the thread", async () => {
  const raw = Buffer.from(rawMessage({ account: "j@x.com", to: ["a@b.com"], cc: ["c@d.com"], subject: "Café night\r\nBcc: evil@x.com", body: "Hi there" }), "base64url").toString();
  assert.match(raw, /^To: a@b\.com\r\nCc: c@d\.com\r\nSubject: =\?UTF-8\?B\?/);
  assert.doesNotMatch(raw, /\r\nBcc:/, "no header injection through the subject");
  assert.ok(raw.endsWith(`\r\n\r\n${Buffer.from("Hi there").toString("base64")}`));

  stubGoogle((s) => {
    if (s.url.pathname.endsWith("/threads/t1")) return { json: { id: "t1", messages: [{ id: "m0", threadId: "t1", payload: { headers: [{ name: "Message-ID", value: "<orig@mail>" }] } }] } };
    if (s.url.pathname.endsWith("/messages/send")) return { json: { id: "m1", threadId: "t1" } };
  });
  const g = googleGmail(async (account) => `tok-${account}`);
  const m = await g.send({ account: "jeff@example.com", to: ["booker@venue.com"], subject: "Re: dates", body: "Works", threadId: "t1" });
  assert.deepEqual([m.id, m.threadId, m.direction], ["m1", "t1", "sent"]);
  const send = seen.find((s) => s.url.pathname.endsWith("/messages/send"))!;
  assert.equal(send.auth, "Bearer tok-jeff@example.com");
  assert.equal((send.body as { threadId: string }).threadId, "t1");
  assert.match(Buffer.from((send.body as { raw: string }).raw, "base64url").toString(), /In-Reply-To: <orig@mail>\r\nReferences: <orig@mail>/);
});

test("gmail: getThread reads sent and received messages, skips drafts, finds the plain text part", async () => {
  const part = (type: string, text: string) => ({ mimeType: type, body: { data: b64(text) } });
  stubGoogle(() => ({
    json: {
      id: "t9", messages: [
        { id: "a", threadId: "t9", labelIds: ["SENT"], internalDate: "1761500000000", payload: { headers: [{ name: "From", value: "Jeff <jeff@example.com>" }, { name: "To", value: "\"Lake, Lost\" <h@lostlake.example>" }, { name: "Subject", value: "Booking" }], ...part("text/plain", "Hello") } },
        { id: "b", threadId: "t9", labelIds: ["INBOX"], internalDate: "1761600000000", payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: "H <H@LostLake.example>" }, { name: "Subject", value: "Re: Booking" }], parts: [part("text/html", "<p>Sure</p>"), part("text/plain", "Sure, send dates")] } },
        { id: "c", threadId: "t9", labelIds: ["DRAFT"], internalDate: "1761700000000", payload: { headers: [] } },
      ],
    },
  }));
  const th = await googleGmail(token).getThread("t9", "jeff@example.com");
  assert.deepEqual(th.messages.map((m) => [m.id, m.direction, m.from]), [["a", "sent", "jeff@example.com"], ["b", "received", "h@lostlake.example"]]);
  assert.deepEqual(th.messages[0].to, ["h@lostlake.example"], "a comma inside a quoted name doesn't split the address");
  assert.equal(th.messages[1].body, "Sure, send dates");
  assert.equal(th.subject, "Booking");
  await assert.rejects(googleGmail(token).getThread("t9"), (e: unknown) => e instanceof IntegrationError && e.status === 400);
});

test("gmail: a 401 gets one retry with a fresh token", async () => {
  let calls = 0;
  stubGoogle((s) => (s.auth === "Bearer fresh" ? { json: { id: "d1", message: { id: "m", threadId: "t" } } } : (calls++, { status: 401, json: { error: { message: "expired" } } })));
  const d = await googleGmail(async (_a, force) => (force ? "fresh" : "stale")).createDraft({ account: "j@x.com", to: ["a@b.com"], subject: "s", body: "b" });
  assert.equal(d.id, "d1");
  assert.equal(calls, 1);
});

// ---------- Drive API ----------

test("drive: search query, file mapping (anyone and domain sharing), copy into the band folder", async () => {
  stubGoogle((s) => {
    if (s.url.pathname.endsWith("/files") && s.method === "GET") return { json: { files: [{ id: "f1", name: "Glass Coast demo.m4a", mimeType: "audio/mp4", owners: [{ emailAddress: "Jeff@Example.com" }], parents: ["p"], webViewLink: "https://drive/f1",
      permissions: [{ type: "user", role: "owner", emailAddress: "Jeff@Example.com" }, { type: "user", role: "commenter", emailAddress: "ingrid@example.com" }, { type: "domain", role: "reader", domain: "band.com" }, { type: "anyone", role: "reader" }] }] } };
    if (s.url.pathname.endsWith("/copy")) return { json: { id: "f2", name: "x", mimeType: "audio/mp4", parents: ["band-folder"] } };
  });
  const d = googleDrive(token);
  const [f] = await d.search({ q: "Ingrid's song" });
  assert.equal(seen[0].url.searchParams.get("q"), "trashed = false and name contains 'Ingrid\\'s song'");
  assert.equal(f.ownerEmail, "jeff@example.com");
  assert.deepEqual(f.permissions, [{ email: "jeff@example.com", role: "owner" }, { email: "ingrid@example.com", role: "reader" }]);
  assert.equal(f.anyoneWithLink, true);
  assert.deepEqual(f.domains, ["band.com"]);
  const c = await d.copy("f1", { parentId: "band-folder", name: "x" });
  assert.deepEqual((seen.at(-1)!.body as { parents: string[] }).parents, ["band-folder"]);
  assert.equal(c.webViewLink, "https://drive.google.com/open?id=f2");
});

test("drive: share skips people who already have access and asks Drive to notify when it must", async () => {
  const created: string[] = [];
  stubGoogle((s) => {
    if (s.method === "GET") return { json: { id: "f1", name: "n", mimeType: "m", owners: [{ emailAddress: "jeff@example.com" }], permissions: [{ type: "user", role: "reader", emailAddress: "ingrid@example.com" }] } };
    const email = (s.body as { emailAddress: string }).emailAddress;
    if (email === "nogoogle@example.com" && s.url.searchParams.get("sendNotificationEmail") === "false") return { status: 400, json: { error: { message: "must notify" } } };
    created.push(`${email}:${s.url.searchParams.get("sendNotificationEmail")}`);
    return { json: { id: "p" } };
  });
  await googleDrive(token).share("f1", ["jeff@example.com", "Ingrid@example.com", "david@example.com", "nogoogle@example.com"]);
  assert.deepEqual(created, ["david@example.com:false", "nogoogle@example.com:true"]);
});

test("missingFor: link and domain sharing count", () => {
  const mates = [{ id: "m1", name: "A", email: "a@band.com" }, { id: "m2", name: "B", email: "b@gmail.com" }];
  const base = { id: "f", name: "n", mimeType: "m", ownerEmail: "o@x.com", parents: [], permissions: [], createdAt: "", webViewLink: "" };
  assert.deepEqual(missingFor(base, mates), ["m1", "m2"]);
  assert.deepEqual(missingFor({ ...base, domains: ["band.com"] }, mates), ["m2"]);
  assert.deepEqual(missingFor({ ...base, anyoneWithLink: true }, mates), []);
});

// ---------- Calendar API ----------

test("calendar: create sends invites with local times and a time zone; update keeps answers; a deleted event is not found", async () => {
  stubGoogle((s) => {
    if (s.method === "POST") return { json: { id: "e1", summary: "Show", start: { dateTime: "2026-11-07T18:00:00-07:00", timeZone: "America/Denver" }, end: { dateTime: "2026-11-07T22:00:00-07:00" }, attendees: [{ email: "a@x.com", responseStatus: "needsAction" }] } };
    if (s.method === "GET" && s.url.pathname.endsWith("/e1")) return { json: { id: "e1", start: { dateTime: "2026-11-07T18:00:00-07:00", timeZone: "America/Denver" }, attendees: [{ email: "a@x.com", responseStatus: "accepted" }] } };
    if (s.method === "PATCH") return { json: { id: "e1" } };
    if (s.method === "DELETE") return { status: 410, json: { error: { message: "Resource has been deleted" } } };
  });
  const cal = googleCalendar(token);
  const ev = await cal.create({ title: "Show", start: "2026-11-07T18:00:00", end: "2026-11-07T22:00:00", timeZone: "America/Denver", attendees: ["a@x.com"] });
  assert.equal(ev.timeZone, "America/Denver");
  const ins = seen[0];
  assert.equal(ins.url.pathname, "/calendar/v3/calendars/primary/events");
  assert.equal(ins.url.searchParams.get("sendUpdates"), "all");
  assert.deepEqual((ins.body as { start: unknown }).start, { dateTime: "2026-11-07T18:00:00", date: null, timeZone: "America/Denver" });
  await cal.update("e1", { start: "2026-11-07T19:00:00", attendees: ["A@x.com", "b@x.com"] });
  const patch = seen.find((s) => s.method === "PATCH")!.body as { status: string; start: unknown; attendees: unknown };
  assert.equal(patch.status, "confirmed");
  assert.deepEqual(patch.start, { dateTime: "2026-11-07T19:00:00", date: null, timeZone: "America/Denver" });
  assert.deepEqual(patch.attendees, [{ email: "A@x.com", responseStatus: "accepted" }, { email: "b@x.com", responseStatus: "needsAction" }]);
  await assert.rejects(cal.delete("e1"), (e: unknown) => e instanceof IntegrationError && e.status === 404);
});

test("calendar: the band calendar gets events; all-day events use dates; the calendar list pages and reads access", async () => {
  stubGoogle((s) => {
    if (s.method === "POST") return { json: { id: "e2", summary: "Rehearsal", start: { date: "2026-11-08" }, end: { date: "2026-11-09" } } };
    if (s.url.pathname.endsWith("/calendarList") && !s.url.searchParams.get("pageToken")) return { json: { items: [{ id: "me@x.com", summary: "Me", accessRole: "owner", primary: true }], nextPageToken: "p2" } };
    if (s.url.pathname.endsWith("/calendarList")) return { json: { items: [{ id: "band@group.calendar.google.com", summary: "Band", summaryOverride: "The Band", accessRole: "writer" }] } };
    if (s.url.pathname.endsWith("/calendarList/view%40group.calendar.google.com") || s.url.pathname.endsWith("/calendarList/view@group.calendar.google.com")) return { json: { id: "view@group.calendar.google.com", summary: "Venues", accessRole: "reader" } };
  });
  const cal = googleCalendar(token, "band@group.calendar.google.com");
  const ev = await cal.create({ title: "Rehearsal", start: "2026-11-08", end: "2026-11-09" });
  assert.equal(seen[0].url.pathname, "/calendar/v3/calendars/band%40group.calendar.google.com/events");
  assert.deepEqual((seen[0].body as { start: unknown }).start, { date: "2026-11-08", dateTime: null });
  assert.equal(ev.start, "2026-11-08");
  assert.deepEqual(await cal.calendars(), [
    { id: "me@x.com", name: "Me", accessRole: "owner", primary: true },
    { id: "band@group.calendar.google.com", name: "The Band", accessRole: "writer" },
  ]);
  assert.equal((await cal.calendar("view@group.calendar.google.com")).accessRole, "reader");
  await assert.rejects(cal.calendar("nope"), (e: unknown) => e instanceof IntegrationError && e.status === 404);
});

// ---------- connecting (commands, against the emulators) ----------

const bearer = (t: string) => `Bearer ${t}`;
const idToken = (email: string) => `x.${b64(JSON.stringify({ email }))}.y`;

beforeEach(resetEmulators);

test("google.status says when Google isn't set up", async () => {
  const jeff = await makeUser("jeff@example.com", "admin");
  const r = await dispatch("google.status", bearer(jeff.token), {});
  const st = (r.json as { result: { configured: boolean; me: unknown; band: unknown; bandFolder: unknown } }).result;
  assert.deepEqual([st.configured, st.me, st.band, st.bandFolder], [false, null, null, null]);
  assert.equal((await dispatch("google.connectUrl", bearer(jeff.token), { features: ["gmail"] })).status, 503);
});

test("connect: consent URL, finish only for the admin who started it, band account, real Gmail, disconnect", async () => {
  const restore = withGoogleEnv();
  const gmailWas = process.env.GMAIL_BASE_URL;
  try {
    await makeArtist("Ingrid Avison Band", "iab");
    const jeff = await makeUser("jeff@example.com", "admin");
    const ingrid = await makeUser("ingrid@example.com", "admin");
    const member = await makeUser("david@example.com", "member");
    assert.equal((await dispatch("google.status", bearer(member.token), {})).status, 403, "admins only");

    const r = await dispatch("google.connectUrl", bearer(jeff.token), { features: ["gmail", "calendar"] });
    const url = new URL((r.json as { result: { url: string } }).result.url);
    assert.match(url.searchParams.get("redirect_uri")!, /^http.*\/api\/google\/callback$/);
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("login_hint"), "jeff@example.com");
    assert.deepEqual(url.searchParams.get("scope")!.split(" "), ["openid", "email", ...FEATURE_SCOPES.gmail, ...FEATURE_SCOPES.calendar]);
    const state = url.searchParams.get("state")!;

    stubGoogle((s) => {
      if (s.url.href === TOKEN_URL && new URLSearchParams(s.body as string).get("grant_type") === "authorization_code") {
        return { json: { access_token: "at-1", expires_in: 3600, refresh_token: "1//rt", scope: ["openid", ...FEATURE_SCOPES.gmail, ...FEATURE_SCOPES.calendar].join(" "), id_token: idToken("Jeff.Dean@gmail.com") } };
      }
      if (s.url.pathname.endsWith("/messages/send")) return { json: { id: "m1", threadId: "t1" } };
      if (s.url.href.startsWith(REVOKE_URL)) return { json: {} };
    });
    assert.equal((await dispatch("google.finishConnect", bearer(ingrid.token), { code: "c", state })).status, 400, "someone else's state is refused");
    const done = await dispatch("google.finishConnect", bearer(jeff.token), { code: "c", state });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    const st = (done.json as { result: { me: unknown; band: { email: string; isMe: boolean }; missing: string[] } }).result;
    assert.deepEqual(st.me, { googleEmail: "jeff.dean@gmail.com", features: ["gmail", "calendar"] });
    assert.deepEqual([st.band.email, st.band.isMe, st.missing], ["jeff.dean@gmail.com", true, []]);
    assert.deepEqual((await db.get("artists", TEST_ARTIST))?.google, { uid: jeff.uid, email: "jeff.dean@gmail.com" });

    // Gmail goes real once Google is configured and GMAIL_BASE_URL is unset, sending with Jeff's own grant.
    delete process.env.GMAIL_BASE_URL;
    await gmailClient().send({ account: "jeff@example.com", to: ["a@b.com"], subject: "Hi", body: "b" });
    assert.equal(seen.find((s) => s.url.pathname.endsWith("/messages/send"))?.auth, "Bearer at-1");
    await assert.rejects(accessTokenForEmail("ingrid@example.com", "gmail"), /hasn't connected Google/);

    const off = await dispatch("google.disconnect", bearer(jeff.token), {});
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
