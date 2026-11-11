// Covers the pure show helpers in @/lib/shows: dates, home plan, filters, names and ask-message retargeting.

import { test } from "node:test";
import assert from "node:assert/strict";
import { planHome, addDays, retargetAskMessage, fmtTime, showFilter, showTabFor, showName, publicShowName, showCity } from "@/lib/shows";

test("pure: dates, home plan", () => {
  assert.equal(addDays("2027-03-01", -1), "2027-02-28");
  assert.equal(fmtTime("19:05"), "7:05 pm");

  const sh = (i: string, date: string, status: "hold" | "confirmed" | "played" | "canceled" = "confirmed") => ({ id: i, date, status });
  const shows = [sh("t1", "2026-10-23"), sh("t2", "2026-10-23"), sh("y", "2026-10-22"), sh("old", "2026-10-01", "played"), sh("n1", "2026-11-14"), sh("x", "2026-10-30", "canceled")];
  const open = { id: "a1", askedMusicianIds: ["me"], responses: {} as Record<string, never> };
  const closed = { id: "a2", askedMusicianIds: ["me"], responses: {}, closedAt: new Date() };
  const answered = { id: "a3", askedMusicianIds: ["me"], responses: { me: { answer: "yes" as const } } };
  const admin = planHome({ role: "admin", musicianId: "me", shows, asks: [open, closed, answered], today: "2026-10-23", unsettled: new Set(["y", "old"]) });
  assert.deepEqual(admin.today.map((s) => s.id), ["t1", "t2"]);
  assert.deepEqual(admin.recent.map((s) => s.id), ["y"]);
  assert.equal(admin.next?.id, "n1");
  assert.deepEqual(admin.asks.map((a) => a.id), ["a1"]);
  const settled = planHome({ role: "admin", shows, asks: [], today: "2026-10-23", unsettled: new Set() });
  assert.equal(settled.recent.length, 0);
  const member = planHome({ role: "member", musicianId: "me", shows, asks: [open], today: "2026-10-23" });
  assert.deepEqual(member.recent.map((s) => s.id), ["y"]);
});

test("showFilter: every show is upcoming, played, canceled or dropped", () => {
  const today = "2026-10-23";
  const f = (status: "hold" | "confirmed" | "played" | "canceled" | "dropped", date: string) => showFilter({ id: "x", status, date }, today);
  assert.equal(f("confirmed", "2026-11-01"), "upcoming");
  assert.equal(f("hold", "2026-10-23"), "upcoming");
  assert.equal(f("played", "2026-10-01"), "played");
  assert.equal(f("confirmed", "2026-10-01"), "played");
  assert.equal(f("canceled", "2026-11-01"), "canceled");
  assert.equal(f("hold", "2026-10-22"), "dropped");
  assert.equal(f("dropped", "2026-11-01"), "dropped");
  assert.equal(f("dropped", "2026-10-01"), "dropped");
});

test("showTabFor: a member sees only the past shows they played, and no canceled or dropped", () => {
  const today = "2026-10-23";
  const show = (status: "hold" | "confirmed" | "played" | "canceled" | "dropped", date: string, personnel: string[]) => ({ id: "x", status, date, personnel });
  const hugo = { musicianId: "m-hugo" };
  assert.equal(showTabFor(show("played", "2026-10-01", ["m-hugo"]), today, hugo), "played");
  assert.equal(showTabFor(show("confirmed", "2026-10-01", ["m-hugo"]), today, hugo), "played");
  assert.equal(showTabFor(show("played", "2026-10-01", ["m-felix"]), today, hugo), null);
  assert.equal(showTabFor(show("played", "2026-10-01", ["m-felix"]), today, {}), null, "no musician: no past shows");
  assert.equal(showTabFor(show("confirmed", "2026-11-01", ["m-felix"]), today, hugo), "upcoming", "upcoming shows are all listed");
  assert.equal(showTabFor(show("canceled", "2026-11-01", ["m-hugo"]), today, hugo), null);
  assert.equal(showTabFor(show("dropped", "2026-11-01", ["m-hugo"]), today, hugo), null);
  assert.equal(showTabFor(show("hold", "2026-10-01", ["m-hugo"]), today, hugo), null);
  assert.equal(showTabFor(show("played", "2026-10-01", ["m-felix"]), today, null), "played", "admins see every show");
  assert.equal(showTabFor(show("canceled", "2026-11-01", []), today, null), "canceled");
});

test("showName / publicShowName / showCity", () => {
  assert.equal(showName({ venue: { id: "v", name: "Deep End", city: "Denver" } }), "Deep End");
  assert.equal(showName({ kind: "house", hostName: "Mary", place: { city: "Boulder" } }), "House concert · Mary");
  assert.equal(showName({ kind: "house", place: { city: "Boulder" } }), "House concert");
  assert.equal(showName({ kind: "festival", editionName: "Hygiene Festival 2025", place: { city: "Hygiene" } }), "Hygiene Festival 2025");
  assert.equal(publicShowName({ kind: "house", hostName: "Mary", place: { city: "Boulder" } }), "House concert");
  assert.equal(showCity({ kind: "house", place: { city: "Boulder" } }), "Boulder");
});

test("retargetAskMessage: a typed ask message swaps the dates it was typed with for the new ones; null once they were rewritten", () => {
  assert.equal(retargetAskMessage("Hey all, show on [date]?", [], ["2027-03-06"]), "Hey all, show on Sat, Mar 6?");
  assert.equal(retargetAskMessage("Hey all, show on Sat, Mar 6?", ["2027-03-06"], ["2027-03-06", "2027-03-12"]), "Hey all, show on Sat, Mar 6 or Fri, Mar 12?");
  assert.equal(retargetAskMessage("Show on Sat, Mar 6 or Fri, Mar 12!", ["2027-03-06", "2027-03-12"], ["2027-03-12"]), "Show on Fri, Mar 12!");
  assert.equal(retargetAskMessage("Show on $& [date]", [], ["2027-03-06"]), "Show on $& Sat, Mar 6");
  assert.equal(retargetAskMessage("Show early March?", ["2027-03-06"], ["2027-03-12"]), null);
  assert.equal(retargetAskMessage("Show early March?", ["2027-03-06"], ["2027-03-06"]), "Show early March?");
});
