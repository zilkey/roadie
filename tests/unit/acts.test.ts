import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanActName, actStats, actListed, roomsLine, type EvLike, type VenueLike, type ActStats } from "@/lib/acts";

const nameOf = (raw: string) => {
  const c = cleanActName(raw);
  assert.ok("name" in c, `${raw} should be kept, got ${JSON.stringify(c)}`);
  return c.name;
};

test("cleanActName keeps the act and trims the decoration", () => {
  const cases: [string, string][] = [
    ["BJ Barham (of American Aquarium)", "BJ Barham"],
    ["Key Glock - Big5 Live!", "Key Glock"],
    ["LIVE at the Lodge - Denson", "Denson"],
    ["Saosin: 20 Years of Self-Titled", "Saosin"],
    ["with Seven Suns", "Seven Suns"],
  ];
  for (const [raw, want] of cases) assert.equal(nameOf(raw), want, raw);
});

test("cleanActName: 'The X' and 'X' share a key", () => {
  const a = cleanActName("The Brothers Comatose"), b = cleanActName("Brothers Comatose");
  assert.ok("key" in a && "key" in b);
  assert.equal(a.key, b.key);
});

test("cleanActName drops names that are not acts", () => {
  for (const raw of [
    "Open Mic Night", "& More!", "Fridays)", "very", "musical guest lighthearted",
    "Deer Creek Sharpshooters (11/27) and Tonewood (11/28)", "JAMØ – Earl Grey – Crisco",
    "Magic Mountain Author Talks: Danah Boyd - on The Federal Bureaucracy", "",
  ]) {
    const c = cleanActName(raw);
    assert.ok("drop" in c, `${JSON.stringify(raw)} should be dropped, got ${JSON.stringify(c)}`);
  }
});

// ---------- actStats ----------

const venues = new Map<string, VenueLike>([
  ["aggie", { id: "aggie", name: "Aggie Theatre", address: { city: "Fort Collins", state: "CO" } }],
  ["blue", { id: "blue", name: "Bluebird Theater", address: { city: "Denver", state: "CO" } }],
  ["slc", { id: "slc", name: "Depot", address: { city: "Salt Lake City", state: "UT" } }],
  ["slc2", { id: "slc2", name: "Urban Lounge", address: { city: "Salt Lake City", state: "UT" } }],
]);
let n = 0;
const ev = (venueId: string, date: string, acts: EvLike["acts"], status = "onsale"): EvLike => ({ id: `e${++n}`, venueId, date, status, acts });
const TODAY = "2026-11-10";

test("actStats: the next show carries its ticket link", () => {
  const e = { ...ev("aggie", "2026-11-20", [{ name: "T", role: "headliner", actId: "t" }]), ticketUrl: "https://tix.example/t" };
  assert.equal(actStats([e], venues, new Set(), TODAY).get("t")?.next?.ticketUrl, "https://tix.example/t");
});

test("actStats: rooms with roles, next show skips past, gone and cancelled", () => {
  const events = [
    ev("aggie", "2026-10-01", [{ name: "A", role: "headliner", actId: "a" }]), // past
    ev("blue", "2026-11-12", [{ name: "A", role: "headliner", actId: "a" }], "gone"),
    ev("blue", "2026-11-13", [{ name: "A", role: "headliner", actId: "a" }], "cancelled"),
    ev("aggie", "2026-11-20", [{ name: "A", role: "support", actId: "a" }]),
    ev("aggie", "2026-11-22", [{ name: "A", role: "headliner", actId: "a" }]),
    ev("blue", "2026-11-25", [{ name: "A", role: "unknown", actId: "a" }]),
    ev("blue", "2026-11-26", [{ name: "Open Mic" , role: "headliner" }]), // unlinked
  ];
  const s = actStats(events, venues, new Set(), TODAY).get("a")!;
  assert.equal(s.next?.date, "2026-11-20");
  assert.equal(s.next?.venueId, "aggie");
  assert.equal(s.next?.role, "support");
  assert.equal(s.next?.ticketUrl, undefined);
  const aggie = s.rooms.find((r) => r.venueId === "aggie")!;
  assert.deepEqual(aggie.roles.slice().sort(), ["headliner", "support"]);
  assert.equal(aggie.city, "Fort Collins");
  // gone is not a room by itself; cancelled and past still count as rooms; unknown counts as headliner
  assert.deepEqual(s.rooms.map((r) => r.venueId).sort(), ["aggie", "blue"]);
  assert.deepEqual(s.rooms.find((r) => r.venueId === "blue")!.roles, ["headliner"]);
  assert.deepEqual(s.cities.sort(), ["Denver", "Fort Collins"]);
  assert.equal(actStats(events, venues, new Set(), TODAY).size, 1, "unlinked names have no stats");
});

test("actStats: a gone event alone gives no room", () => {
  const s = actStats([ev("blue", "2026-11-12", [{ name: "A", role: "headliner", actId: "a" }], "gone")], venues, new Set(), TODAY);
  assert.equal(s.size, 0);
});

test("actStats: openedAt is support at rooms on our list only", () => {
  const events = [
    ev("aggie", "2026-09-01", [{ name: "A", role: "support", actId: "a" }]),
    ev("blue", "2026-09-02", [{ name: "A", role: "support", actId: "a" }]),
    ev("slc", "2026-09-03", [{ name: "A", role: "headliner", actId: "a" }]),
    ev("aggie", "2026-09-04", [{ name: "A", role: "support", actId: "a" }]),
  ];
  const s = actStats(events, venues, new Set(["aggie", "slc"]), TODAY).get("a")!;
  assert.deepEqual(s.openedAt, ["aggie"]);
});

test("actStats: tour needs 2 different CO rooms within 28 days, from today on", () => {
  const a = (venueId: string, date: string, actId = "a") => ev(venueId, date, [{ name: actId, role: "headliner", actId }]);
  const tour = (events: EvLike[]) => actStats(events, venues, new Set(), TODAY).get("a")!.tour;
  assert.equal(tour([a("aggie", "2026-11-20"), a("blue", "2026-12-18")]), true, "exactly 28 days apart");
  assert.equal(tour([a("aggie", "2026-11-20"), a("blue", "2026-12-19")]), false, "29 days apart");
  assert.equal(tour([a("aggie", "2026-11-20"), a("aggie", "2026-11-21")]), false, "one venue twice");
  assert.equal(tour([a("slc", "2026-11-20"), a("slc2", "2026-11-21")]), false, "not Colorado");
  assert.equal(tour([a("aggie", "2026-11-20"), a("slc", "2026-11-21")]), false, "one CO room only");
  assert.equal(tour([a("aggie", "2026-11-01"), a("blue", "2026-11-05")]), false, "past shows don't make a tour");
  assert.equal(tour([a("aggie", "2026-11-20"), { ...a("blue", "2026-11-21"), status: "cancelled" }]), false, "cancelled doesn't");
});

test("roomsLine", () => {
  assert.equal(
    roomsLine([{ venueId: "a", name: "Aggie", roles: ["support"] }, { venueId: "b", name: "Blue", roles: ["headliner"] }, { venueId: "c", name: "C", roles: ["headliner", "support"] }]),
    "Aggie (opening) · Blue (headlining) · C (headlining, opening)",
  );
});

// ---------- actListed ----------

const stats = (p: Partial<ActStats> = {}): ActStats => ({ rooms: [], openedAt: [], tour: false, cities: [], ...p });

test("actListed: all lists everyone but not-a-fit, unless searched for", () => {
  const f = { filter: "all" as const };
  assert.equal(actListed({ name: "Saosin" }, undefined, undefined, f), true);
  assert.equal(actListed({ name: "Saosin" }, undefined, { relationship: "notFit" }, f), false);
  assert.equal(actListed({ name: "Saosin" }, undefined, { relationship: "notFit" }, { ...f, q: "saos" }), true);
  assert.equal(actListed({ name: "Saosin" }, undefined, undefined, { ...f, q: "denson" }), false);
  assert.equal(actListed({ name: "Saosin" }, undefined, undefined, { ...f, q: "  SAOS " }), true);
});

test("actListed: shortlist, opened, tour and city filters", () => {
  const a = { name: "X" };
  assert.equal(actListed(a, stats(), { shortlist: true }, { filter: "shortlist" }), true);
  assert.equal(actListed(a, stats(), {}, { filter: "shortlist" }), false);
  assert.equal(actListed(a, stats(), undefined, { filter: "shortlist" }), false);
  assert.equal(actListed(a, stats({ openedAt: ["aggie"] }), undefined, { filter: "opened" }), true);
  assert.equal(actListed(a, stats(), undefined, { filter: "opened" }), false);
  assert.equal(actListed(a, undefined, undefined, { filter: "opened" }), false);
  assert.equal(actListed(a, stats({ tour: true }), undefined, { filter: "tour" }), true);
  assert.equal(actListed(a, stats(), undefined, { filter: "tour" }), false);
  assert.equal(actListed(a, stats({ cities: ["Denver"] }), undefined, { filter: "all", city: "Denver" }), true);
  assert.equal(actListed(a, stats({ cities: ["Denver"] }), undefined, { filter: "all", city: "Boulder" }), false);
  assert.equal(actListed(a, undefined, undefined, { filter: "all", city: "Denver" }), false);
  assert.equal(actListed(a, stats({ tour: true, cities: ["Denver"] }), undefined, { filter: "tour", city: "Boulder" }), false);
});

test("actListed: genres, any picked one, adding up with the other filters", () => {
  const a = { name: "X", genres: ["indie folk", "americana"] };
  assert.equal(actListed(a, stats(), undefined, { filter: "all", genres: [] }), true);
  assert.equal(actListed(a, stats(), undefined, { filter: "all", genres: ["indie"] }), true);
  assert.equal(actListed(a, stats(), undefined, { filter: "all", genres: ["metal", "americana"] }), true);
  assert.equal(actListed(a, stats(), undefined, { filter: "all", genres: ["metal"] }), false);
  assert.equal(actListed({ name: "Y" }, stats(), undefined, { filter: "all", genres: ["indie"] }), false); // no genres known
  assert.equal(actListed(a, stats(), {}, { filter: "shortlist", genres: ["indie"] }), false);
  assert.equal(actListed(a, stats(), { shortlist: true }, { filter: "shortlist", genres: ["indie"] }), true);
});
