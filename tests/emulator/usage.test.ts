/**
 * Tenancy phase 9: daily limits per artist (usage/{artistId}_{date}, platform/limits), exempt artists, and suspension
 * (platformArtists/{id}): app commands, MCP keys, Shortcut tokens and the fan page are refused; claims drop the artist.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { adminAuth, firestore } from "@/server/admin";
import { dispatch } from "@/server/commands/dispatch";
import { artistCtx, systemCtx, type Ctx } from "@/server/ctx";
import { AppError } from "@/server/errors";
import { geocodeText } from "@/server/geocode";
import { setArtistFlags } from "@/server/platform";
import { chargeTo, spend, usageId } from "@/server/usage";
import { handleChat } from "@/server/assistant/chat";
import { authenticateToken, mintKey } from "../../mcp/auth";
import { authenticateShortcut, createShortcutToken } from "@/server/shortcut";
import { listArtist } from "@/server/fans";
import { db } from "@/server/db";
import { resetEmulators, makeUser, makeArtist, readySession, SYS, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  if (s.running["fake-ors"]) process.env.ORS_BASE_URL = s.running["fake-ors"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const OTHER = "other-artist";
beforeEach(async () => {
  await resetEmulators();
  await makeArtist("Nora Quill Band", "nora-quill-band");
  await makeArtist("Fern Valley Trio", "fern-valley-trio", OTHER, "America/New_York");
});
const bearer = (t: string) => `Bearer ${t}`;
const ctxOf = (artistId: string, now?: Date): Ctx => artistCtx({ uid: "u1", role: "admin", artistId, via: "app", ...(now ? { now } : {}) });
const setLimits = (l: Record<string, number>) => firestore().doc("platform/limits").set(l);
const counters = async (artistId: string, date: string) => (await firestore().collection("usage").doc(usageId(artistId, date)).get()).data();
const limitErr = (e: unknown) => e instanceof AppError && e.code === "limit_reached" && e.status === 429;

test("spend: counts per artist and per day (the artist's own date); past the limit 429 with the reset time, nothing added", async () => {
  await setLimits({ roadieMessages: 2 });
  // 03:00 UTC on the 18th is still the 17th in Denver, and already 22:00 on the 17th in New York
  const now = new Date("2026-11-18T03:00:00Z");
  await spend(ctxOf(TEST_ARTIST, now), "roadieMessages");
  await spend(ctxOf(TEST_ARTIST, now), "roadieMessages");
  await assert.rejects(spend(ctxOf(TEST_ARTIST, now), "roadieMessages"), (e: unknown) => {
    assert.ok(limitErr(e));
    const err = e as AppError;
    assert.equal(err.message, "Nora Quill Band has used today's Roadie messages. It resets at midnight.");
    // midnight in Denver (UTC-7 in November) after the 17th
    assert.deepEqual(err.data, { meter: "roadieMessages", limit: 2, used: 2, resetsAt: "2026-11-18T07:00:00.000Z" });
    return true;
  });
  assert.equal((await counters(TEST_ARTIST, "2026-11-17"))?.roadieMessages, 2, "the refused one isn't counted");
  // another artist has its own counter; another meter its own field
  await spend(ctxOf(OTHER, now), "roadieMessages");
  await spend(ctxOf(TEST_ARTIST, now), "webLookups", 5);
  assert.equal((await counters(OTHER, "2026-11-17"))?.roadieMessages, 1);
  assert.equal((await counters(TEST_ARTIST, "2026-11-17"))?.webLookups, 5);
  // the next day (in Denver) starts again
  await spend(ctxOf(TEST_ARTIST, new Date("2026-11-18T08:00:00Z")), "roadieMessages");
  assert.equal((await counters(TEST_ARTIST, "2026-11-18"))?.roadieMessages, 1);
});

test("spend: Q8 defaults without platform/limits; exempt artists and system jobs are never refused", async () => {
  await assert.rejects(spend(ctxOf(TEST_ARTIST), "transcriptions", 31), limitErr);
  await spend(ctxOf(TEST_ARTIST), "transcriptions", 30);
  await setArtistFlags(TEST_ARTIST, { exempt: true }, "test");
  await spend(ctxOf(TEST_ARTIST), "transcriptions", 100);
  await spend(systemCtx("test job"), "maps", 10_000);
  assert.equal((await firestore().collection("usage").where("artistId", "==", TEST_ARTIST).get()).docs[0].get("transcriptions"), 130, "exempt still counts");
});

test("maps: charged only on a cache miss; geo.autocomplete answers 429 past the day's maps", async () => {
  await setLimits({ maps: 2 });
  const ctx = ctxOf(TEST_ARTIST);
  const date = (await counters(TEST_ARTIST, "x")) ?? null;
  assert.equal(date, null);
  assert.ok(await geocodeText("Boise, ID", chargeTo(ctx, "maps")));
  assert.ok(await geocodeText("Boise, ID", chargeTo(ctx, "maps")), "the second is a cache hit");
  const [doc] = (await firestore().collection("usage").where("artistId", "==", TEST_ARTIST).get()).docs;
  assert.equal(doc.get("maps"), 1);
  const admin = await makeUser("a@example.com", "admin");
  assert.equal((await dispatch("geo.autocomplete", bearer(admin.token), { q: "2363 Alder" })).status, 200);
  const r = await dispatch("geo.autocomplete", bearer(admin.token), { q: "2363 Alder" });
  assert.equal(r.status, 429);
  assert.equal((r.json as { error: { code: string } }).error.code, "limit_reached");
});

test("Roadie: a message past the day's limit is refused before anything is saved", async () => {
  await setLimits({ roadieMessages: 0 });
  const admin = await makeUser("a@example.com", "admin");
  const res = await handleChat(bearer(admin.token), { message: "hi", pageContext: { route: "calendar" } }, TEST_ARTIST);
  assert.equal(res.status, 429);
  assert.match(((await res.json()) as { error: { message: string } }).error.message, /used today's Roadie messages/);
  assert.equal((await firestore().collection("assistantThreads").get()).size, 0);
});

test("suspend: app commands, MCP keys, Shortcut tokens and the fan page are refused; claims and the picker drop the artist", async () => {
  await db.update(SYS, "artists", TEST_ARTIST, { features: { fans: true } });
  const both = await makeUser("both@example.com", "admin", { artists: [{ artistId: TEST_ARTIST, role: "admin" }, { artistId: OTHER, role: "admin" }] });
  await db.update(SYS, "users", both.uid, { artists: [{ artistId: TEST_ARTIST, role: "admin", mcpAccess: true }, { artistId: OTHER, role: "admin" }] });
  const key = await mintKey(both.uid, TEST_ARTIST, "test");
  const shortcut = await createShortcutToken(artistCtx({ uid: both.uid, role: "admin", artistId: TEST_ARTIST, via: "app" }));
  // before: all fine
  assert.equal((await dispatch("tours.list", bearer(both.token), {}, TEST_ARTIST)).status, 200);
  await authenticateToken(key);
  await authenticateShortcut(shortcut.token);
  await listArtist("nora-quill-band");

  await setArtistFlags(TEST_ARTIST, { suspended: true }, "test");
  const r = await dispatch("tours.list", bearer(both.token), {}, TEST_ARTIST);
  assert.equal(r.status, 403);
  assert.equal((r.json as { error: { code: string } }).error.code, "suspended");
  await assert.rejects(authenticateToken(key), (e: any) => e.code === "suspended");
  await assert.rejects(authenticateShortcut(shortcut.token), (e: any) => e.code === "suspended");
  await assert.rejects(listArtist("nora-quill-band"), (e: any) => e.status === 404);
  // the other artist still works, and is all the session and the claims show
  assert.equal((await dispatch("tours.list", bearer(both.token), {}, OTHER)).status, 200);
  const s = await readySession(bearer(both.token));
  assert.deepEqual(s.artists.map((a) => a.artistId), [OTHER]);
  const claims = (await adminAuth().getUser(both.uid)).customClaims as { artists: Record<string, string>; adminOf: string[] };
  assert.deepEqual(claims.artists, { [OTHER]: "admin" });
  assert.deepEqual(claims.adminOf, [OTHER]);

  // unsuspended: back as it was
  await setArtistFlags(TEST_ARTIST, { suspended: false }, "test");
  assert.equal((await dispatch("tours.list", bearer(both.token), {}, TEST_ARTIST)).status, 200);
});
