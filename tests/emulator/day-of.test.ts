/**
 * The day-of banner (#66): the window (earliest time, fallbacks, time zones, crossing midnight, no times), the order when
 * rows stack, what a row says through the day, and dayOf.dismiss (per person, per show or rehearsal).
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "@/server/commands/dispatch";
import { dayOfDismissed } from "@/server/prefs";
import { firestore } from "@/server/admin";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";

beforeEach(resetEmulators);

// ---------- dayOf.dismiss ----------

test("dayOf.dismiss: stored in the caller's prefs per artist, per show or rehearsal and date; nobody else's banner changes", async () => {
  const rudy = await makeUser("rudy@example.com", "admin");
  const hugo = await makeUser("hugo@example.com", "member");
  const fs = firestore();
  await fs.doc("shows/s1").set({ date: "2026-11-10", status: "confirmed", artistId: TEST_ARTIST, times: { loadIn: "17:00" }, deletedAt: null });
  await fs.doc("shows/other").set({ date: "2026-11-10", status: "confirmed", artistId: "another-artist", times: {}, deletedAt: null });
  await fs.doc("shows/gone").set({ date: "2026-11-10", status: "confirmed", artistId: TEST_ARTIST, times: {}, deletedAt: new Date() });
  await fs.doc("rehearsals/r1").set({ date: "2026-11-10", startTime: "19:00", personnel: [], songs: [], deletedAt: null });
  const call = (tok: string, body: unknown) => dispatch("dayOf.dismiss", `Bearer ${tok}`, body, TEST_ARTIST);

  const res = await call(rudy.token, { kind: "show", id: "s1" });
  assert.equal(res.status, 200);
  assert.deepEqual((res.json as { result: unknown }).result, { dismissed: "show:s1:2026-11-10" });
  assert.deepEqual(await dayOfDismissed(rudy.uid, TEST_ARTIST), ["show:s1:2026-11-10"]);
  assert.deepEqual(await dayOfDismissed(hugo.uid, TEST_ARTIST), [], "Hugo still sees it");

  // A member can hide theirs too; twice is once; the rehearsal is its own row.
  assert.equal((await call(hugo.token, { kind: "rehearsal", id: "r1" })).status, 200);
  await call(hugo.token, { kind: "rehearsal", id: "r1" });
  assert.deepEqual(await dayOfDismissed(hugo.uid, TEST_ARTIST), ["rehearsal:r1:2026-11-10"]);
  await call(rudy.token, { kind: "rehearsal", id: "r1" });
  assert.deepEqual(await dayOfDismissed(rudy.uid, TEST_ARTIST), ["show:s1:2026-11-10", "rehearsal:r1:2026-11-10"]);
  assert.deepEqual(await dayOfDismissed(rudy.uid, "another-artist"), [], "kept per artist");

  // Nothing is written on the show, and the other prefs stay.
  assert.equal((await fs.doc("shows/s1").get()).data()?.dismissed, undefined);
  await dispatch("calendar.setTours", `Bearer ${rudy.token}`, { on: true }, TEST_ARTIST);
  await call(rudy.token, { kind: "show", id: "s1" });
  assert.equal((await fs.doc(`userPrefs/${rudy.uid}`).get()).data()?.calendarTours, true);

  // Unknown, deleted, another artist's, and bad input are refused.
  assert.equal((await call(rudy.token, { kind: "show", id: "nope" })).status, 404);
  assert.equal((await call(rudy.token, { kind: "show", id: "gone" })).status, 404);
  assert.equal((await call(rudy.token, { kind: "show", id: "other" })).status, 404);
  assert.equal((await call(rudy.token, { kind: "rehearsal", id: "s1" })).status, 404);
  assert.equal((await call(rudy.token, { kind: "pitch", id: "s1" })).status, 400);
  assert.equal((await dispatch("dayOf.dismiss", null, { kind: "show", id: "s1" }, TEST_ARTIST)).status, 401);
});

test("dayOf.dismiss drops dismissals older than a week as it goes", async () => {
  const rudy = await makeUser("rudy@example.com", "admin");
  const fs = firestore();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(new Date());
  await fs.doc("shows/s1").set({ date: today, status: "confirmed", artistId: TEST_ARTIST, times: {}, deletedAt: null });
  await fs.doc(`userPrefs/${rudy.uid}`).set({ uid: rudy.uid, dayOfDismissed: { [TEST_ARTIST]: ["show:old:2020-01-01", `rehearsal:r:${today}`], elsewhere: ["show:x:2020-01-01"] } });
  assert.equal((await dispatch("dayOf.dismiss", `Bearer ${rudy.token}`, { kind: "show", id: "s1" }, TEST_ARTIST)).status, 200);
  assert.deepEqual(await dayOfDismissed(rudy.uid, TEST_ARTIST), [`rehearsal:r:${today}`, `show:s1:${today}`]);
  assert.deepEqual(await dayOfDismissed(rudy.uid, "elsewhere"), ["show:x:2020-01-01"], "another artist's list is left alone");
});
