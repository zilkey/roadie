import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { execute } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { firestore } from "@/server/admin";
import { newRunId, type Ctx } from "@/server/ctx";
import { AppError } from "@/server/errors";
import { SignupBody, fanCtx, fanId, listView, signup, upsertFan } from "@/server/fans";
import { DEFAULT_LIST_WORDING, groupOf, haversineMiles, mergeCities, parseCity } from "@/lib/fans";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx, mctx: Ctx, aictx: Ctx;
let venueId: string;
let showId: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.ORS_BASE_URL = s.running["fake-ors"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};
const refused = (p: Promise<unknown>, code = "forbidden") => assert.rejects(p, (e: AppError) => e.code === code);

// Saturday 2026-11-14, set 21:00 Denver (UTC-7). 03:30Z on the 15th is 20:30 MST: inside the window.
const DURING = new Date("2026-11-15T03:30:00Z");
const NOON_AFTER = new Date("2026-11-15T19:00:00Z");
const NEVER = new Date("2027-06-01T12:00:00Z");

beforeEach(async () => {
  await resetEmulators();
  const a = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  ctx = { uid: a.uid, role: "admin", artistId: TEST_ARTIST, via: "app", runId: newRunId() };
  const m = await makeUser("david@example.com", "member", { name: "David" });
  mctx = { uid: m.uid, role: "member", artistId: TEST_ARTIST, via: "app", runId: newRunId() };
  // An AI-only login (not an admin): MCP carries role "mcp" whoever the person is.
  const ai = await makeUser("bot@example.com", "member", { name: "Bot" });
  aictx = { uid: ai.uid, role: "mcp", artistId: TEST_ARTIST, via: "mcp", runId: newRunId() };
  await db.create(ctx, "artists", {
    slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: { instagram: "ingridavison" }, configurations: [],
    features: { fans: true },
  }, { id: TEST_ARTIST });
  venueId = (await cmd("venues.create", venue("Hi-Dive", "Denver", { address: { street: "7 S Broadway", city: "Denver", state: "CO" } }))).id;
  showId = (await cmd("shows.create", {
    date: "2026-11-14", venueId, status: "confirmed", times: { doors: "20:00", set: "21:00", setLengthSec: 3600 },
    sendInvites: false, deal: { deal: "guarantee", guarantee: 40000 },
  })).id;
});

// ---------- pure ----------

test("pure: cities merge case-insensitively, the latest moves last, groups are City, ST", () => {
  const m = mergeCities([{ city: "Denver", state: "CO", lat: 1, lng: 2 }, { city: "Boise", state: "ID" }], [{ city: "denver" }, { city: "Salt Lake City", state: "UT" }]);
  assert.deepEqual(m.map((c) => c.city), ["Boise", "Denver", "Salt Lake City"]);
  assert.deepEqual(m[1], { city: "Denver", state: "CO", lat: 1, lng: 2 });
  assert.equal(groupOf(m), "Salt Lake City, UT");
  assert.equal(groupOf([]), "No city");
  assert.equal(groupOf([{ city: "Moab" }]), "Moab");
  assert.ok(Math.abs(haversineMiles({ lat: 39.74, lng: -104.99 }, { lat: 40.015, lng: -105.27 }) - 25) < 4);
});

test("fanId is stable per artist and lowercased email", () => {
  assert.equal(fanId("a", "Fan@Example.com"), fanId("a", "fan@example.com"));
  assert.notEqual(fanId("a", "fan@example.com"), fanId("b", "fan@example.com"));
});

// ---------- public list ----------

test("list: 404 when the artist doesn't exist or fans are off; shows only public facts", async () => {
  await refused(listView("nobody", DURING), "not_found");
  const v = await listView("ingrid-avison-band", DURING);
  assert.deepEqual(v.current, { showId, label: "Hi-Dive · Denver", date: "2026-11-14", mode: "during" });
  assert.equal(v.artistName, "Ingrid Avison Band");
  assert.equal(v.instagram, "ingridavison");
  assert.equal(v.wording, DEFAULT_LIST_WORDING);
  assert.deepEqual(v.choices, [{ showId, label: "Hi-Dive · Denver", date: "2026-11-14" }]);
  const json = JSON.stringify(v);
  for (const secret of ["7 S Broadway", "40000", "guarantee", "personnel"]) assert.ok(!json.includes(secret), secret);

  assert.equal((await listView("ingrid-avison-band", NOON_AFTER)).current?.mode, "morning-after");
  assert.equal((await listView("ingrid-avison-band", NEVER)).current, null);

  await db.update(ctx, "artists", TEST_ARTIST, { listWording: "Join the list" });
  assert.equal((await listView("ingrid-avison-band", DURING)).wording, "Join the list");
  await db.update(ctx, "artists", TEST_ARTIST, { features: { fans: false } });
  await refused(listView("ingrid-avison-band", DURING), "not_found");
});

test("list: the venue's time zone moves the window", async () => {
  // Set 21:00 for an hour: the window runs 18:00 to 01:00 (the next night) in the venue's own zone.
  const pacific = (await cmd("venues.create", venue("Crocodile", "Seattle", { address: { city: "Seattle", state: "WA" } }))).id;
  await db.update(ctx, "venues", pacific, { timeZone: "America/Los_Angeles" });
  const s2 = (await cmd("shows.create", { date: "2026-12-05", venueId: pacific, status: "confirmed", times: { set: "21:00", setLengthSec: 3600 }, sendInvites: false })).id;
  // 08:30Z on the 6th is 00:30 PST (still inside) but 01:30 MST (half an hour past the Denver-zone window).
  const at = new Date("2026-12-06T08:30:00Z");
  assert.deepEqual((await listView("ingrid-avison-band", at)).current, { showId: s2, label: "Crocodile · Seattle", date: "2026-12-05", mode: "during" });
  await db.update(ctx, "venues", pacific, { timeZone: null });
  assert.equal((await listView("ingrid-avison-band", at)).current?.mode, "morning-after", "no zone on the venue = the band's");
});

// ---------- public signup ----------

test("signup: validation is server-side", async () => {
  assert.equal(SignupBody.safeParse({ email: "nope", page: "/f/x" }).success, false);
  assert.equal(SignupBody.safeParse({ email: "a@b.co" }).success, false, "page is required");
  assert.equal(SignupBody.safeParse({ email: "a@b.co", page: "/f/x", extra: 1 }).success, false);
  assert.equal(SignupBody.parse({ email: "  Fan@Example.COM ", page: "/f/x" }).email, "fan@example.com");
});

test("signup at a show: city from the venue doc, geocoded, consent set once, merges on the second visit", async () => {
  const body = SignupBody.parse({ email: "Fan@Example.com", firstName: "Fran", showId, page: "/f/ingrid-avison-band" });
  assert.deepEqual(await signup("ingrid-avison-band", body, DURING), { ok: true });
  const id = fanId(TEST_ARTIST, "fan@example.com");
  let fan = (await db.get("fans", id))!;
  assert.equal(fan.email, "fan@example.com");
  assert.equal(fan.source, "list");
  assert.deepEqual(fan.showIds, [showId]);
  assert.equal(fan.cities.length, 1);
  assert.equal(fan.cities[0].city, "Denver"); assert.equal(fan.cities[0].state, "CO");
  assert.equal(typeof fan.cities[0].lat, "number");
  assert.deepEqual(fan.consent, { text: DEFAULT_LIST_WORDING, at: DURING.toISOString(), page: "/f/ingrid-avison-band" });
  const cached = await firestore().collection("geocodes").get();
  assert.equal(cached.size, 1, "the lookup is cached");

  await db.update(ctx, "artists", TEST_ARTIST, { listWording: "New wording" });
  const later = new Date(DURING.getTime() + 86_400_000);
  await signup("ingrid-avison-band", SignupBody.parse({ email: "fan@example.com", city: "boise, id", page: "/f/other" }), later);
  fan = (await db.get("fans", id))!;
  assert.deepEqual(fan.cities.map((c: any) => [c.city, c.state]), [["Denver", "CO"], ["Boise", "ID"]]);
  assert.equal(fan.firstName, "Fran");
  assert.equal(fan.consent.text, DEFAULT_LIST_WORDING, "consent is only set on the first join");
  assert.equal((await db.list("fans")).length, 1);
  // The change log carries the artist, so rules keep it to that artist's admins.
  const hist = await db.history("fans", id);
  assert.ok(hist.length >= 2 && hist.every((h) => h.artistId === TEST_ARTIST));
});

test("signup: refuses a show that isn't countable or isn't this band's; a geocode outage doesn't fail it", async () => {
  const hold = (await cmd("shows.create", { date: "2026-12-01", venueId, status: "hold", times: {}, sendInvites: false })).id;
  await refused(signup("ingrid-avison-band", SignupBody.parse({ email: "a@b.co", showId: hold, page: "/f/x" })), "invalid_input");
  await refused(signup("ingrid-avison-band", SignupBody.parse({ email: "a@b.co", showId: "nope", page: "/f/x" })), "invalid_input");
  await refused(signup("not-a-band", SignupBody.parse({ email: "a@b.co", page: "/f/x" })), "not_found");
  assert.equal((await db.list("fans")).length, 0);

  const was = process.env.ORS_BASE_URL;
  process.env.ORS_BASE_URL = "http://127.0.0.1:1";
  try { await signup("ingrid-avison-band", SignupBody.parse({ email: "down@example.com", city: "Moab, UT", page: "/f/x" })); } finally { process.env.ORS_BASE_URL = was; }
  const fan = (await db.get("fans", fanId(TEST_ARTIST, "down@example.com")))!;
  assert.deepEqual(fan.cities, [{ city: "Moab", state: "UT" }]);
});

test("signup at a house show: city only, no state", async () => {
  const house = (await cmd("shows.create", { date: "2026-12-12", kind: "house", place: { city: "Nederland", address: "1 Secret Ln" }, status: "confirmed", times: {}, sendInvites: false })).id;
  const v = await listView("ingrid-avison-band", new Date("2026-12-12T20:00:00Z"));
  assert.equal(v.current?.label, "House concert · Nederland");
  assert.ok(!JSON.stringify(v).includes("Secret"));
  await signup("ingrid-avison-band", SignupBody.parse({ email: "h@example.com", showId: house, page: "/f/x" }));
  const fan = (await db.get("fans", fanId(TEST_ARTIST, "h@example.com")))!;
  assert.deepEqual(fan.cities.map((c: any) => [c.city, c.state]), [["Nederland", undefined]]);
});

// ---------- commands: who sees what ----------

test("roles: members and AI non-admins get counts only; admins get everything", async () => {
  await cmd("fans.add", { email: "one@example.com", city: "Denver, CO" });
  for (const n of ["add", "update", "remove", "list", "forBandzoogle", "markSynced"]) assert.ok(!registry[`fans.${n}`].roles.includes("member"), n);
  for (const n of ["counts", "near", "newSince"]) assert.ok(registry[`fans.${n}`].roles.includes("member"), n);
  // Through the dispatcher a member is refused the admin commands outright.
  await refused(execute(mctx, "fans.list", {}));
  await refused(execute(mctx, "fans.add", { email: "x@example.com" }));
  // MCP is the same for a person who is not an admin of the artist: read the role, not the transport.
  await refused(cmd("fans.list", {}, aictx));
  await refused(cmd("fans.add", { email: "x@example.com" }, aictx));
  await refused(cmd("fans.forBandzoogle", {}, aictx));
  await refused(cmd("fans.markSynced", { group: "Denver, CO" }, aictx));
  await refused(cmd("fans.remove", { id: fanId(TEST_ARTIST, "one@example.com") }, aictx));
  for (const c of [mctx, aictx]) {
    const counts = await cmd("fans.counts", {}, c);
    assert.equal(counts.total, 1);
    assert.ok(!JSON.stringify(counts).includes("@"));
    const near = await cmd("fans.near", { place: "Denver, CO" }, c);
    assert.equal(near.count, 1); assert.equal(near.fans, undefined);
    assert.ok(!JSON.stringify(await cmd("fans.newSince", { showId }, c)).includes("@"));
  }
  assert.equal((await cmd("fans.list", {})).fans[0].email, "one@example.com");
  assert.equal((await cmd("fans.near", { place: "Denver, CO" })).fans[0].email, "one@example.com");
  // An admin reached through MCP sees the list.
  const adminAi = await makeUser("jeff2@example.com", "admin", { name: "Jeff 2" });
  assert.equal((await cmd("fans.list", {}, { ...aictx, uid: adminAi.uid })).count, 1);
});

test("fans.add / update / remove: paper source, merge, geocode, hard delete takes the history too", async () => {
  const a = await cmd("fans.add", { email: "Paper@Example.com", firstName: "Pat", showId });
  assert.equal(a.created, true);
  const fan = (await db.get("fans", a.id))!;
  assert.equal(fan.source, "paper"); assert.equal(fan.consent, undefined);
  assert.deepEqual(fan.cities.map((c: any) => [c.city, c.state]), [["Denver", "CO"]]);
  assert.equal(typeof fan.cities[0].lat, "number");
  assert.equal((await cmd("fans.add", { email: "paper@example.com", city: "Salt Lake City, UT" })).created, false);
  assert.equal((await db.get("fans", a.id))!.cities.length, 2);
  await refused(cmd("fans.add", { email: "z@example.com", showId: "nope" }), "invalid_input");

  await cmd("fans.update", { id: a.id, patch: { firstName: null, cities: [{ city: "Moab", state: "ut" }] } });
  const up = (await db.get("fans", a.id))!;
  assert.equal(up.firstName, undefined);
  assert.deepEqual(up.cities.map((c: any) => [c.city, c.state, typeof c.lat]), [["Moab", "UT", "number"]]);

  assert.deepEqual(await cmd("fans.remove", { id: a.id }), { id: a.id, removed: true });
  assert.equal(await db.get("fans", a.id), null);
  assert.equal((await firestore().collection(`fans/${a.id}/history`).get()).size, 0);
  await refused(cmd("fans.remove", { id: a.id }), "not_found");
});

test("fans are scoped to the caller's artist", async () => {
  await cmd("fans.add", { email: "mine@example.com", city: "Denver" });
  const other = { ...ctx, artistId: "other-artist" };
  assert.equal((await cmd("fans.list", {}, other)).count, 0);
  assert.equal((await cmd("fans.counts", {}, other)).total, 0);
  await refused(cmd("fans.remove", { id: fanId(TEST_ARTIST, "mine@example.com") }, other), "not_found");
});

// ---------- counts, near, newSince ----------

test("fans.counts: totals by city and show, no addresses; fans.list filters", async () => {
  await signup("ingrid-avison-band", SignupBody.parse({ email: "a@example.com", showId, page: "/f/x" }), DURING);
  await signup("ingrid-avison-band", SignupBody.parse({ email: "b@example.com", city: "Boise, ID", page: "/f/x" }), DURING);
  await cmd("fans.add", { email: "c@example.com" });
  const c = await cmd("fans.counts", { since: "2000-01-01" });
  assert.equal(c.total, 3);
  assert.deepEqual(c.byCity, { "Boise, ID": 1, "Denver, CO": 1, "No city": 1 });
  assert.deepEqual(c.byShow.map((s: any) => [s.showId, s.label, s.count]), [[showId, "Hi-Dive · Denver · 2026-11-14", 1]]);
  assert.equal(c.notInBandzoogle, 3);
  assert.equal(c.newSince, 3);
  assert.equal((await cmd("fans.counts", { since: "2999-01-01" })).newSince, 0);

  assert.deepEqual((await cmd("fans.list", { showId })).fans.map((f: any) => f.email), ["a@example.com"]);
  assert.deepEqual((await cmd("fans.list", { city: "boise" })).fans.map((f: any) => f.email), ["b@example.com"]);
  assert.equal((await cmd("fans.list", { notInBandzoogle: true })).count, 3);
});

test("fans.near: haversine over geocoded cities, nearest first, venue and place and lat/lng centers", async () => {
  const w = (email: string, city: string, state: string, lat?: number, lng?: number) =>
    upsertFan(fanCtx(TEST_ARTIST), { artistId: TEST_ARTIST, email, cities: [{ city, state, ...(lat !== undefined ? { lat, lng } : {}) }], showIds: [], source: "list" });
  await w("boulder@example.com", "Boulder", "CO", 40.015, -105.27);       // ~25 mi from Denver
  await w("springs@example.com", "Colorado Springs", "CO", 38.834, -104.82); // ~63 mi
  await w("slc@example.com", "Salt Lake City", "UT", 40.76, -111.89);     // ~370 mi
  const here = { lat: 39.7392, lng: -104.9903 };
  const r = await cmd("fans.near", { ...here, miles: 60 });
  assert.equal(r.count, 1);
  assert.deepEqual(r.fans.map((f: any) => [f.email, f.city]), [["boulder@example.com", "Boulder, CO"]]);
  assert.equal((await cmd("fans.near", { ...here, miles: 100 })).count, 2);
  assert.deepEqual((await cmd("fans.near", { ...here, miles: 100 })).fans.map((f: any) => f.email), ["boulder@example.com", "springs@example.com"]);
  // A venue center is its geocoded town; fans from that same town are at distance 0.
  await w("denver@example.com", "Denver", "CO");
  const byVenue = await cmd("fans.near", { venueId, miles: 1 });
  assert.deepEqual(byVenue.fans.map((f: any) => f.email), ["denver@example.com"]);
  assert.equal((await cmd("fans.near", { place: "Denver, CO", miles: 1 })).count, 1);
  await assert.rejects(registry["fans.near"].input.parseAsync({ place: "x", lat: 1, lng: 2 }));
  await assert.rejects(registry["fans.near"].input.parseAsync({ lat: 1 }));
});

test("fans.newSince counts the fans a show added that aren't in Bandzoogle yet", async () => {
  await signup("ingrid-avison-band", SignupBody.parse({ email: "a@example.com", showId, page: "/f/x" }), DURING);
  await signup("ingrid-avison-band", SignupBody.parse({ email: "b@example.com", showId, page: "/f/x" }), DURING);
  await signup("ingrid-avison-band", SignupBody.parse({ email: "c@example.com", city: "Boise", page: "/f/x" }), DURING);
  assert.deepEqual(await cmd("fans.newSince", { showId }, mctx), { showId, label: "Hi-Dive · Denver", date: "2026-11-14", added: 2, notInBandzoogle: 2, totalNotInBandzoogle: 3 });
  await cmd("fans.markSynced", { ids: [fanId(TEST_ARTIST, "a@example.com")] });
  const n = await cmd("fans.newSince", { showId });
  assert.equal(n.added, 2); assert.equal(n.notInBandzoogle, 1); assert.equal(n.totalNotInBandzoogle, 2);
  assert.deepEqual(await cmd("fans.newSince", {}), { notInBandzoogle: 2 });
});

// ---------- Bandzoogle ----------

test("fans.forBandzoogle groups by the most recent city; fans.markSynced stamps once and never offers again", async () => {
  await cmd("fans.add", { email: "d1@example.com", city: "Denver", state: "CO" });
  await cmd("fans.add", { email: "d2@example.com", city: "denver, co" });
  await cmd("fans.add", { email: "b1@example.com", city: "Boise, ID" });
  await cmd("fans.add", { email: "none@example.com" });
  await cmd("fans.add", { email: "d1@example.com", city: "Boise, ID" }); // d1's latest city is now Boise
  const r = await cmd("fans.forBandzoogle", {});
  assert.equal(r.total, 4);
  assert.deepEqual(r.groups.map((g: any) => [g.group, g.count]), [["Boise, ID", 2], ["Denver, CO", 1], ["No city", 1]]);
  const boise = r.groups[0];
  assert.deepEqual(boise.emails, ["b1@example.com", "d1@example.com"]);
  assert.equal(boise.csv, "b1@example.com, d1@example.com");

  const stamped = await cmd("fans.markSynced", { group: "boise, id" });
  assert.deepEqual(stamped, { marked: 2, skipped: 0, groups: { "Boise, ID": 2 } });
  const fan = (await db.get("fans", fanId(TEST_ARTIST, "b1@example.com")))!;
  assert.equal(fan.bandzoogle.group, "Boise, ID");
  assert.ok(fan.bandzoogle.addedAt);
  assert.deepEqual((await cmd("fans.forBandzoogle", {})).groups.map((g: any) => g.group), ["Denver, CO", "No city"]);
  // Marking by id skips anyone already stamped; a fan who comes back is still not offered.
  const again = await cmd("fans.markSynced", { ids: [fan.id, fanId(TEST_ARTIST, "none@example.com")] });
  assert.deepEqual(again, { marked: 1, skipped: 1, groups: { "No city": 1 } });
  await cmd("fans.add", { email: "b1@example.com", city: "Moab, UT" });
  assert.ok(!(await cmd("fans.forBandzoogle", {})).groups.some((g: any) => g.emails.includes("b1@example.com")));
  await assert.rejects(registry["fans.markSynced"].input.parseAsync({ ids: ["x"], group: "y" }));
  await assert.rejects(registry["fans.markSynced"].input.parseAsync({}));
  assert.equal((await cmd("fans.list", { notInBandzoogle: true })).count, 1);
});

test("parseCity title-cases an all-lowercase city, leaves mixed case alone, and uppercases the state", () => {
  assert.deepEqual(parseCity("denver, co"), { city: "Denver", state: "CO" });
  assert.deepEqual(parseCity("salt lake city"), { city: "Salt Lake City" });
  assert.deepEqual(parseCity("McCall, id"), { city: "McCall", state: "ID" });
});
