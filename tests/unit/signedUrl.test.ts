import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { signUrl, signedOk, expiryFor } from "@/server/signedUrl";

const HOUR = 60 * 60_000;
const saved = { secret: process.env.SIGNED_URL_SECRET, project: process.env.GCLOUD_PROJECT };
beforeEach(() => { process.env.SIGNED_URL_SECRET = "test-secret"; delete process.env.GCLOUD_PROJECT; });
afterEach(() => {
  for (const [k, v] of [["SIGNED_URL_SECRET", saved.secret], ["GCLOUD_PROJECT", saved.project]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

const at = Date.parse("2026-11-12T10:20:00.000Z");
const ok = (s: { exp: string; sig: string }, now = at, scope: "thumb" | "media" = "thumb", artist = "band-a", id = "file-1", v = "2026-11-01T18:00:00.000Z") =>
  signedOk(scope, artist, id, v, s.exp, s.sig, now);

test("a link is good until the start of the hour plus 2 hours, and the same all through the hour", () => {
  const s = signUrl("thumb", "band-a", "file-1", "2026-11-01T18:00:00.000Z", at);
  assert.equal(Number(s.exp), Date.parse("2026-11-12T12:00:00.000Z"));
  assert.deepEqual(signUrl("thumb", "band-a", "file-1", "2026-11-01T18:00:00.000Z", Date.parse("2026-11-12T10:59:59.000Z")), s, "the same URL within the hour");
  assert.notDeepEqual(signUrl("thumb", "band-a", "file-1", "2026-11-01T18:00:00.000Z", Date.parse("2026-11-12T11:00:00.000Z")), s, "a new one the next hour");
  assert.equal(expiryFor(at), Number(s.exp));
  assert.equal(ok(s), true);
  assert.equal(ok(s, Date.parse("2026-11-12T11:59:59.000Z")), true);
});

test("expired, a wrong signature, another band, another file, version or scope: all refused", () => {
  const s = signUrl("thumb", "band-a", "file-1", "2026-11-01T18:00:00.000Z", at);
  assert.equal(ok(s, Number(s.exp)), false, "expired at exp");
  assert.equal(ok(s, Number(s.exp) + HOUR), false, "expired");
  assert.equal(ok({ ...s, sig: s.sig.replace(/^./, (c) => (c === "a" ? "b" : "a")) }), false, "wrong signature");
  assert.equal(ok({ ...s, sig: s.sig.slice(1) }), false, "a shorter signature");
  assert.equal(ok({ ...s, exp: String(Number(s.exp) + HOUR) }), false, "a later expiry isn't signed");
  assert.equal(ok(s, at, "thumb", "band-b"), false, "another band's file");
  assert.equal(ok(s, at, "thumb", "band-a", "file-2"), false, "another file");
  assert.equal(ok(s, at, "thumb", "band-a", "file-1", "2026-11-02T00:00:00.000Z"), false, "an edited photo needs a new link");
  assert.equal(ok(s, at, "media"), false, "a thumb link isn't a media link");
  assert.equal(signedOk("thumb", "band-a", "file-1", "0", null, null, at), false);
  assert.equal(signedOk("thumb", "band-a", "file-1", "0", "soon", s.sig, at), false);
});

test("the key is SIGNED_URL_SECRET: a link signed with another key fails", () => {
  const s = signUrl("media", "band-a", "post-1", "0", at);
  assert.equal(ok(s, at, "media", "band-a", "post-1", "0"), true);
  process.env.SIGNED_URL_SECRET = "another";
  assert.equal(ok(s, at, "media", "band-a", "post-1", "0"), false);
});

test("no secret: a fixed dev key in dev and on demo- projects; a 503 on a real project", () => {
  delete process.env.SIGNED_URL_SECRET;
  const dev = signUrl("thumb", "band-a", "file-1", "0", at);
  assert.equal(signedOk("thumb", "band-a", "file-1", "0", dev.exp, dev.sig, at), true);
  process.env.GCLOUD_PROJECT = "demo-band-tracker";
  assert.deepEqual(signUrl("thumb", "band-a", "file-1", "0", at), dev, "the emulator uses the same dev key");
  process.env.GCLOUD_PROJECT = "roadie-prod-iab";
  for (const f of [() => signUrl("thumb", "band-a", "file-1", "0", at), () => signedOk("thumb", "band-a", "file-1", "0", dev.exp, dev.sig, at)]) {
    assert.throws(f, (e: { status?: number; message?: string }) => e.status === 503 && e.message === "Signed links aren't set up on this server");
  }
});
