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
import { DEFAULT_LIST_WORDING } from "@/lib/fans";
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

// Saturday 2026-11-14, set 21:00 Denver (UTC-7) = 04:00Z on the 15th: signups from 03:00Z to 07:00Z belong to it.
const DURING = new Date("2026-11-15T03:30:00Z");
const NOON_AFTER = new Date("2026-11-15T19:00:00Z");
const NEVER = new Date("2027-06-01T12:00:00Z");

beforeEach(async () => {
  await resetEmulators();
  const a = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  ctx = { uid: a.uid, role: "admin", artistId: TEST_ARTIST, via: "app", runId: newRunId() };
  const m = await makeUser("hugo@example.com", "member", { name: "Hugo" });
  mctx = { uid: m.uid, role: "member", artistId: TEST_ARTIST, via: "app", runId: newRunId() };
  // An AI-only login (not an admin): MCP carries role "mcp" whoever the person is.
  const ai = await makeUser("bot@example.com", "member", { name: "Bot" });
  aictx = { uid: ai.uid, role: "mcp", artistId: TEST_ARTIST, via: "mcp", runId: newRunId() };
  await db.create(ctx, "artists", {
    slug: "nora-quill-band", name: "Nora Quill Band", driveFolderId: "", links: { instagram: "noraquill" }, configurations: [],
    features: { fans: true },
  }, { id: TEST_ARTIST });
  venueId = (await cmd("venues.create", venue("Deep End", "Denver", { address: { street: "7 S Broadway", city: "Denver", state: "CO" } }))).id;
  showId = (await cmd("shows.create", {
    date: "2026-11-14", venueId, status: "confirmed", times: { doors: "20:00", set: "21:00", setLengthSec: 3600 },
    sendInvites: false, deal: { deal: "guarantee", guarantee: 40000 },
  })).id;
});

// ---------- pure ----------

// ---------- public list ----------

test("list: 404 when the artist doesn't exist or fans are off; shows only public facts", async () => {
  await refused(listView("nobody", DURING), "not_found");
  const v = await listView("nora-quill-band", DURING);
  assert.deepEqual(v.current, { showId, label: "Deep End · Denver", date: "2026-11-14" });
  assert.equal(v.artistName, "Nora Quill Band");
  assert.deepEqual(v.socials, [{ key: "instagram", label: "Instagram", url: "https://instagram.com/noraquill" }]);
  assert.equal(v.logo, null);
  assert.equal(v.shows, null);
  assert.deepEqual(v.links, []);
  assert.equal(v.wording, DEFAULT_LIST_WORDING);
  assert.equal(v.merch, null);
  assert.deepEqual(v.style, { theme: "auto", accent: null });
  const json = JSON.stringify(v);
  for (const secret of ["7 S Broadway", "40000", "guarantee", "personnel"]) assert.ok(!json.includes(secret), secret);

  assert.equal((await listView("nora-quill-band", NOON_AFTER)).current, null, "no morning-after: only the signup window counts");
  assert.equal((await listView("nora-quill-band", NEVER)).current, null);

  await db.update(ctx, "artists", TEST_ARTIST, { listWording: "Join the list" });
  assert.equal((await listView("nora-quill-band", DURING)).wording, "Join the list");
  await db.update(ctx, "artists", TEST_ARTIST, { features: { fans: false } });
  await refused(listView("nora-quill-band", DURING), "not_found");
});

test("list: public name, merch price list with the Venmo handle, and style", async () => {
  const items = [{ id: "a", name: "Coozie", priceCents: 500 }, { id: "b", name: "T-Shirt", priceCents: 2500 }];
  await cmd("artists.update", { id: TEST_ARTIST, patch: { publicName: "Nora Quill", merchItems: items, fanPageStyle: { theme: "dark", accent: "#e8590c" } } });
  let v = await listView("nora-quill-band", NEVER);
  assert.equal(v.artistName, "Nora Quill");
  assert.equal(v.merch, null, "merch off and no payment link: no price list");
  assert.deepEqual(v.style, { theme: "dark", accent: "#e8590c" });
  await cmd("artists.update", { id: TEST_ARTIST, patch: { features: { fans: true, merch: true }, paymentUrl: "@Nora-Quill" } });
  v = await listView("nora-quill-band", NEVER);
  assert.deepEqual(v.merch, { venmo: "Nora-Quill", items });
  await cmd("artists.update", { id: TEST_ARTIST, patch: { merchItems: [] } });
  assert.equal((await listView("nora-quill-band", NEVER)).merch, null, "no items: no merch section");
  await cmd("artists.update", { id: TEST_ARTIST, patch: { publicName: null } });
  assert.equal((await listView("nora-quill-band", NEVER)).artistName, "Nora Quill Band");
  await assert.rejects(cmd("artists.update", { id: TEST_ARTIST, patch: { merchItems: [{ id: "x", name: "", priceCents: 5 }] } }), "an item needs a name");
});

test("list: a show's fan page line from 1h before the show to 3h after; ?showId= previews it; links in order; socials in the artist's order; the logo", async () => {
  await cmd("artists.update", { id: TEST_ARTIST, patch: { paymentUrl: "@Nora-Quill" } });
  await cmd("shows.update", { id: showId, patch: { fanPage: { on: true, amountCents: 2000, button: "donation", name: "Jennifer House Concert" } } });
  const line = { id: showId, name: "Jennifer House Concert", amountCents: 2000, button: "donation" };
  assert.deepEqual((await listView("nora-quill-band", DURING)).shows, { venmo: "Nora-Quill", items: [line] });
  assert.ok((await listView("nora-quill-band", new Date("2026-11-15T02:59:00Z"))).shows === null, "not yet: more than 1h before the set");
  assert.ok((await listView("nora-quill-band", new Date("2026-11-15T07:00:00Z"))).shows, "still there 3h after");
  assert.equal((await listView("nora-quill-band", new Date("2026-11-15T07:01:00Z"))).shows, null, "gone after 3h");
  assert.deepEqual((await listView("nora-quill-band", NEVER, showId)).shows?.items, [line], "the preview link shows it any time");
  await cmd("shows.update", { id: showId, patch: { fanPage: { on: false, amountCents: 2000 } } });
  assert.equal((await listView("nora-quill-band", DURING)).shows, null, "unchecked");
  assert.deepEqual((await listView("nora-quill-band", DURING, showId)).shows?.items, [{ ...line, name: "Deep End", button: "ticket" }], "preview ignores the checkbox; defaults: venue name, Ticket");
  await cmd("shows.update", { id: showId, patch: { fanPage: { on: true } } });
  assert.equal((await listView("nora-quill-band", DURING, showId)).shows, null, "no amount, no line");
  await cmd("shows.update", { id: showId, patch: { fanPage: { on: true, amountCents: 1500 } } });
  await cmd("artists.update", { id: TEST_ARTIST, patch: { paymentUrl: null } });
  assert.equal((await listView("nora-quill-band", DURING)).shows, null, "no Venmo, no button");
  await assert.rejects(cmd("shows.update", { id: showId, patch: { fanPage: { on: true, amountCents: 50 } } }), "at least $1");

  const links = [{ id: "b", name: "Tour poster", url: "https://example.com/poster" }, { id: "a", name: "New single", url: "https://example.com/single" }];
  await cmd("artists.update", { id: TEST_ARTIST, patch: { fanLinks: links, links: { website: "noraquill.com", instagram: "https://instagram.com/noraquill", spotify: "https://open.spotify.com/artist/x" } } });
  const v = await listView("nora-quill-band", NEVER);
  assert.deepEqual(v.links, links);
  assert.deepEqual(v.socials.map((x) => [x.key, x.url]), [["website", "https://noraquill.com"], ["spotify", "https://open.spotify.com/artist/x"], ["instagram", "https://instagram.com/noraquill"]]);
  await assert.rejects(cmd("artists.update", { id: TEST_ARTIST, patch: { fanLinks: [{ id: "c", name: "Bad", url: "example" }] } }), "a link needs a full URL");

  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  await cmd("artists.update", { id: TEST_ARTIST, patch: { logo: { dataUrl } } });
  assert.equal((await listView("nora-quill-band", NEVER)).logo, dataUrl);
  await assert.rejects(cmd("artists.update", { id: TEST_ARTIST, patch: { logo: { dataUrl: "data:text/html;base64,PGI+" } } }), "only images");
  await cmd("artists.update", { id: TEST_ARTIST, patch: { logo: null } });
  assert.equal((await listView("nora-quill-band", NEVER)).logo, null);
});

test("list: the venue's time zone moves the window", async () => {
  // Set 21:00 Pacific = 05:00Z on the 6th: the window runs 04:00Z to 08:00Z.
  const pacific = (await cmd("venues.create", venue("Crocodile", "Seattle", { address: { city: "Seattle", state: "WA" } }))).id;
  await db.update(ctx, "venues", pacific, { timeZone: "America/Los_Angeles" });
  const s2 = (await cmd("shows.create", { date: "2026-12-05", venueId: pacific, status: "confirmed", times: { set: "21:00", setLengthSec: 3600 }, sendInvites: false })).id;
  // 07:30Z is 23:30 PST (inside) but 00:30 MST (half an hour past the Denver-zone window, 03:00Z to 07:00Z).
  const at = new Date("2026-12-06T07:30:00Z");
  assert.deepEqual((await listView("nora-quill-band", at)).current, { showId: s2, label: "Crocodile · Seattle", date: "2026-12-05" });
  await db.update(ctx, "venues", pacific, { timeZone: null });
  assert.equal((await listView("nora-quill-band", at)).current, null, "no zone on the venue = the band's");
});

// ---------- public signup ----------

test("signup at a show: the show comes from the time, city from the venue doc, consent set once, merges on the second visit", async () => {
  const body = SignupBody.parse({ email: "Fan@Example.com", name: "Fran Lee", page: "/f/nora-quill-band" });
  assert.deepEqual(await signup("nora-quill-band", body, DURING), { ok: true });
  const id = fanId(TEST_ARTIST, "fan@example.com");
  let fan = (await db.get("fans", id))!;
  assert.equal(fan.email, "fan@example.com");
  assert.equal(fan.source, "list");
  assert.equal(fan.firstName, "Fran Lee", "the name is stored under firstName");
  assert.deepEqual(fan.showIds, [showId]);
  assert.equal(fan.cities.length, 1);
  assert.equal(fan.cities[0].city, "Denver"); assert.equal(fan.cities[0].state, "CO");
  assert.equal(typeof fan.cities[0].lat, "number");
  assert.deepEqual(fan.consent, { text: DEFAULT_LIST_WORDING, at: DURING.toISOString(), page: "/f/nora-quill-band" });
  const cached = await firestore().collection("geocodes").get();
  assert.equal(cached.size, 1, "the lookup is cached");

  await db.update(ctx, "artists", TEST_ARTIST, { listWording: "New wording" });
  const later = new Date(DURING.getTime() + 86_400_000);
  await signup("nora-quill-band", SignupBody.parse({ email: "fan@example.com", zip: "80302", page: "/f/other" }), later);
  fan = (await db.get("fans", id))!;
  assert.deepEqual(fan.cities.map((c: any) => [c.city, c.state]), [["Denver", "CO"], ["Boulder", "CO"]], "the zip names a town");
  assert.equal(typeof fan.cities[1].lat, "number");
  assert.equal(fan.zip, "80302");
  assert.deepEqual(fan.showIds, [showId], "a day later is no show");
  assert.equal(fan.firstName, "Fran Lee");
  assert.equal(fan.consent.text, DEFAULT_LIST_WORDING, "consent is only set on the first join");
  assert.equal((await db.list("fans")).length, 1);
  // The change log carries the artist, so rules keep it to that artist's admins.
  const hist = await db.history("fans", id);
  assert.ok(hist.length >= 2 && hist.every((h) => h.artistId === TEST_ARTIST));
});

test("signup: the page can't pick a show; bad zips are refused; a lookup outage doesn't fail it", async () => {
  assert.equal(SignupBody.safeParse({ email: "a@b.co", showId, page: "/f/x" }).success, false);
  assert.equal(SignupBody.safeParse({ email: "a@b.co", city: "Boise", page: "/f/x" }).success, false);
  assert.equal(SignupBody.safeParse({ email: "a@b.co", zip: "8030", page: "/f/x" }).success, false);
  await refused(signup("not-a-band", SignupBody.parse({ email: "a@b.co", page: "/f/x" })), "not_found");
  // A hold on tonight doesn't count.
  await cmd("shows.update", { id: showId, patch: { status: "hold" } });
  await signup("nora-quill-band", SignupBody.parse({ email: "hold@example.com", page: "/f/x" }), DURING);
  assert.deepEqual((await db.get("fans", fanId(TEST_ARTIST, "hold@example.com")))!.showIds, []);

  const was = process.env.ORS_BASE_URL;
  process.env.ORS_BASE_URL = "http://127.0.0.1:1";
  try { await signup("nora-quill-band", SignupBody.parse({ email: "down@example.com", zip: "84532", page: "/f/x" })); } finally { process.env.ORS_BASE_URL = was; }
  const fan = (await db.get("fans", fanId(TEST_ARTIST, "down@example.com")))!;
  assert.deepEqual(fan.cities, []);
  assert.equal(fan.zip, "84532");
});

test("signup at a house show with no times (assumed 19:00): city only, no state", async () => {
  const house = (await cmd("shows.create", { date: "2026-12-12", kind: "house", place: { city: "Nederland", address: "1 Secret Ln" }, status: "confirmed", times: {}, sendInvites: false })).id;
  // 19:00 MST on the 12th = 02:00Z on the 13th.
  const at = new Date("2026-12-13T02:30:00Z");
  const v = await listView("nora-quill-band", at);
  assert.equal(v.current?.showId, house);
  assert.equal(v.current?.label, "House concert · Nederland");
  assert.ok(!JSON.stringify(v).includes("Secret"));
  assert.equal((await listView("nora-quill-band", new Date("2026-12-12T20:00:00Z"))).current, null, "midday is not the show");
  await signup("nora-quill-band", SignupBody.parse({ email: "h@example.com", page: "/f/x" }), at);
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
  const adminAi = await makeUser("rudy2@example.com", "admin", { name: "Rudy 2" });
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
  await signup("nora-quill-band", SignupBody.parse({ email: "a@example.com", page: "/f/x" }), DURING);
  await signup("nora-quill-band", SignupBody.parse({ email: "b@example.com", zip: "80302", page: "/f/x" }), NEVER);
  await cmd("fans.add", { email: "c@example.com" });
  const c = await cmd("fans.counts", { since: "2000-01-01" });
  assert.equal(c.total, 3);
  assert.deepEqual(c.byCity, { "Boulder, CO": 1, "Denver, CO": 1, "No city": 1 });
  assert.deepEqual(c.byShow.map((s: any) => [s.showId, s.label, s.count]), [[showId, "Deep End · Denver · 2026-11-14", 1]]);
  assert.equal(c.notInBandzoogle, 3);
  assert.equal(c.newSince, 3);
  assert.equal((await cmd("fans.counts", { since: "2999-01-01" })).newSince, 0);

  assert.deepEqual((await cmd("fans.list", { showId })).fans.map((f: any) => f.email), ["a@example.com"]);
  assert.deepEqual((await cmd("fans.list", { city: "boulder" })).fans.map((f: any) => f.email), ["b@example.com"]);
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
  await signup("nora-quill-band", SignupBody.parse({ email: "a@example.com", page: "/f/x" }), DURING);
  await signup("nora-quill-band", SignupBody.parse({ email: "b@example.com", page: "/f/x" }), DURING);
  await signup("nora-quill-band", SignupBody.parse({ email: "c@example.com", zip: "80302", page: "/f/x" }), NEVER);
  assert.deepEqual(await cmd("fans.newSince", { showId }, mctx), { showId, label: "Deep End · Denver", date: "2026-11-14", added: 2, notInBandzoogle: 2, totalNotInBandzoogle: 3 });
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
