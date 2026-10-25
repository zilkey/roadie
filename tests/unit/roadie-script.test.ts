import { test } from "node:test";
import assert from "node:assert/strict";
import { script, NO_PEOPLE } from "@/server/assistant/script";
import { BAND_SETTINGS } from "@/server/assistant/policy";
import { RECORD_ROUTES, resolveRoute, routeForPath, routeForRecord } from "@/lib/routes";

const refused = (text: string) => script({ text }).text === NO_PEOPLE && !script({ text }).calls;

test("script: invites, access and feature switches are refused with no tool call", () => {
  for (const t of [
    "invite Mae to the band", "make Sam an admin", "make Sam admin", "make Mae standard", "make Mae a standard user",
    "let Mae log in", "let Mae sign in", "demote Sam", "promote Sam to admin", "turn off the songs feature", "turn on setlists",
    "remove Sam's login", "remove Mae's access", "remove the user Mae", "give Mae access", "change Sam's role", "delete the band", "show me the api keys",
  ]) assert.ok(refused(t), t);
});

test("script: ordinary asks are not swallowed by the refusal", () => {
  for (const t of ["make a checklist", "make a standard setlist", "take Sam off the calendar", "turn off the calendar for Saturday", "turn on the calendar for the Hi-Dive show", "take Mae off the guest list", "add $20 for gas"])
    assert.notEqual(script({ text: t }).text, NO_PEOPLE, t);
});

test("script: NO_PEOPLE points at the People page and offers to open it", () => {
  assert.match(NO_PEOPLE, /People page/);
  assert.match(NO_PEOPLE, /take you there/);
  assert.doesNotMatch(NO_PEOPLE, /Users page/);
});

test("script: renaming the band or changing the URL gets the settings reply, no tool call", () => {
  for (const t of ["rename the band", "Change the band name", "change our URL", "change our web address", "update the band's name"]) {
    const r = script({ text: t });
    assert.equal(r.text, BAND_SETTINGS, t);
    assert.equal(r.calls, undefined, t);
  }
});

test("script: 'pitch list' opens the pitch list", () => {
  assert.deepEqual(script({ text: "open the pitch list" }).calls, [{ name: "ui.navigate", input: { route: "bookingPitches" } }]);
});

test("routes: booking tabs, show tabs and shows filters resolve", () => {
  assert.equal(resolveRoute("bookingPitches")?.href, "/booking/pitches");
  assert.equal(resolveRoute("bookingPitches")?.title, "Pitch List");
  assert.equal(resolveRoute("bookingVenues", {}, "ingrid-avison")?.href, "/artists/ingrid-avison/booking/venues");
  assert.equal(resolveRoute("showSetlist", { id: "abc" })?.href, "/shows/abc?tab=setlist");
  assert.equal(resolveRoute("showFinances", { id: "abc" }, "ingrid-avison")?.href, "/artists/ingrid-avison/shows/abc?tab=finances");
  assert.equal(resolveRoute("showSetlist", {}), null);
  assert.equal(resolveRoute("showSetlist", { id: "a?b" }), null);
  assert.equal(resolveRoute("showsPlayed")?.href, "/shows#played");
  assert.equal(resolveRoute("showsDropped", {}, "ingrid-avison")?.href, "/artists/ingrid-avison/shows#dropped");
});

test("routes: reverse lookup ignores query and hash and keeps the plain route", () => {
  assert.deepEqual(routeForPath("/booking/pitches"), { route: "bookingPitches", params: {} });
  assert.deepEqual(routeForPath("/shows/abc?tab=setlist"), { route: "show", params: { id: "abc" } });
  assert.deepEqual(routeForPath("/artists/ingrid-avison/shows/abc?tab=finances"), { route: "show", params: { id: "abc" }, artist: "ingrid-avison" });
  assert.deepEqual(routeForPath("/shows#played"), { route: "shows", params: {} });
});

test("routes: show tabs validate as shows, but a show record still routes to 'show'", () => {
  assert.equal(RECORD_ROUTES.showSetlist, "shows");
  assert.equal(RECORD_ROUTES.showFinances, "shows");
  assert.equal(routeForRecord("shows"), "show");
});
