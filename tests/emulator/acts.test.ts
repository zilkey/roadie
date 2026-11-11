import { test, before, after, beforeEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { upsertEvents, type EventDraft } from "@/server/events/refresh";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

let ctx: Ctx;
const TZ = "America/Denver";
const NOW = new Date("2026-11-10T18:00:00Z");

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};
const noteId = (actId: string) => `${TEST_ARTIST}__${actId}`;
const take = (actId: string) => db.get("actNotes", noteId(actId));

let stopFakes: () => Promise<void>;
let fakesDir: string;
before(async () => {
  fakesDir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: fakesDir, ephemeral: true });
  stopFakes = s.close;
  process.env.SPOTIFY_BASE_URL = s.running["fake-spotify"].url;
});
after(async () => { await stopFakes(); fs.rmSync(fakesDir, { recursive: true, force: true }); });

beforeEach(async () => {
  await resetEmulators();
  const u = await makeUser("rudy@example.com", "admin");
  ctx = { uid: u.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
});

const makeVenue = async (name: string, city = "Denver", state = "CO") =>
  (await db.create(ctx, "venues", venue(name, city, { address: { city, state } }))).id;
const draft = (sourceId: string, date: string, acts: [string, "headliner" | "support" | "unknown"][], title = acts[0]?.[0] ?? "Show"): EventDraft => ({
  sourceId, date, title, acts: acts.map(([name, role]) => ({ name, role })), bill: "full", status: "onsale",
});
const actByName = async (name: string) => (await db.list("acts")).find((a) => a.name === name);

test("acts.create dedupes by matchKey: 'The Wheelwright' merges into 'Wheelwright'", async () => {
  const a = await cmd("acts.create", { name: "Wheelwright" });
  const b = await cmd("acts.create", { name: "The Wheelwright", genres: ["folk"] });
  assert.equal(b.id, a.id);
  assert.equal((await db.list("acts")).length, 1);
  assert.deepEqual((await db.get("acts", a.id))!.genres, ["folk"]);
});

test("acts.create with this band's fields writes the actNote", async () => {
  const a = await cmd("acts.create", { name: "Saosin", shortlist: true, relationship: "openFor", note: "Big draw" });
  const n = await take(a.id);
  assert.equal(n!.shortlist, true);
  assert.equal(n!.relationship, "openFor");
  assert.equal(n!.note, "Big draw");
  assert.equal(n!.artistId, TEST_ARTIST);
  assert.equal((await db.get("acts", a.id))!.shortlist, undefined, "not on the shared record");
});

test("acts.shortlist on and off", async () => {
  const a = await cmd("acts.create", { name: "Denson" });
  await cmd("acts.shortlist", { id: a.id, on: true });
  assert.equal((await take(a.id))!.shortlist, true);
  await cmd("acts.shortlist", { id: a.id, on: false });
  const n = await take(a.id);
  assert.ok(!n || !n.shortlist);
});

test("acts.note sets relationship and note; null clears", async () => {
  const a = await cmd("acts.create", { name: "Denson" });
  await cmd("acts.note", { id: a.id, relationship: "peer", note: "  Trade shows  " });
  let n = (await take(a.id))!;
  assert.equal(n.relationship, "peer");
  assert.equal(n.note, "Trade shows");
  await cmd("acts.note", { id: a.id, relationship: null });
  n = (await take(a.id))!;
  assert.ok(!n.relationship);
  assert.equal(n.note, "Trade shows", "note untouched");
  await cmd("acts.note", { id: a.id, note: null });
  n = (await take(a.id))!;
  assert.ok(!n.note);
  await assert.rejects(cmd("acts.note", { id: a.id }), /relationship or a note/i);
});

test("acts.update changes the shared fields", async () => {
  const a = await cmd("acts.create", { name: "Denson" });
  await cmd("acts.update", { id: a.id, patch: { hometown: "Boulder, CO", genres: ["rock"], description: "Loud." } });
  const got = (await db.get("acts", a.id))!;
  assert.equal(got.hometown, "Boulder, CO");
  assert.deepEqual(got.genres, ["rock"]);
  assert.equal(got.description, "Loud.");
  assert.equal(got.name, "Denson");
});

test("contacts.attach with kind acts links the contact in actNotes; contacts.remove unlinks it", async () => {
  const a = await cmd("acts.create", { name: "Denson" });
  const c = await cmd("contacts.create", { name: "Rosa", emails: ["rosa@x.com"] });
  await cmd("contacts.attach", { contactId: c.id, kind: "acts", id: a.id });
  await cmd("contacts.attach", { contactId: c.id, kind: "acts", id: a.id }); // idempotent
  assert.deepEqual((await take(a.id))!.contactIds, [c.id]);
  const found = await cmd("acts.find", { q: "Denson" });
  assert.deepEqual(found.rows[0].contactIds, [c.id]);

  const c2 = await cmd("contacts.create", { name: "Sam", emails: ["sam@x.com"], attachTo: { kind: "acts", id: a.id } });
  assert.deepEqual((await take(a.id))!.contactIds, [c.id, c2.id]);
  await cmd("contacts.detach", { contactId: c2.id, kind: "acts", id: a.id });
  assert.deepEqual((await take(a.id))!.contactIds, [c.id]);

  await cmd("contacts.remove", { id: c.id });
  assert.deepEqual((await take(a.id))!.contactIds ?? [], []);
  await assert.rejects(cmd("contacts.attach", { contactId: c.id, kind: "acts", id: "nope" }));
});

test("upsertEvents links acts: creates new ones once, reuses them on a second run, leaves non-acts unlinked", async () => {
  const v = await makeVenue("Pine Hollow Lounge");
  const drafts = () => [
    draft("s1", "2026-11-20", [["Key Glock - Big5 Live!", "headliner"], ["with Seven Suns", "support"]]),
    draft("s2", "2026-11-21", [["Open Mic Night", "headliner"]]),
    draft("s3", "2026-11-22", [["The Brothers Comatose", "headliner"], ["Seven Suns", "support"]]),
  ];
  await upsertEvents(v, "selectors", drafts(), NOW, TZ);
  const names = (await db.list("acts")).map((a) => a.name).sort();
  assert.deepEqual(names, ["Key Glock", "Seven Suns", "The Brothers Comatose"]);

  const evs = await db.list("venueEvents", (q) => q.where("venueId", "==", v));
  const by = (sid: string) => evs.find((e) => e.sourceId === sid)!;
  const glock = (await actByName("Key Glock"))!, suns = (await actByName("Seven Suns"))!;
  assert.deepEqual(by("s1").acts.map((a: any) => a.actId), [glock.id, suns.id]);
  assert.deepEqual(by("s1").actIds, [glock.id, suns.id]);
  assert.equal(by("s2").acts[0].actId, undefined);
  assert.equal(by("s2").actIds, undefined);
  assert.equal(by("s3").acts[1].actId, suns.id, "Seven Suns is one act across bills");

  // Second run: nothing new, same ids; "Brothers Comatose" joins the existing act.
  const again = drafts();
  again.push(draft("s4", "2026-11-23", [["Brothers Comatose", "headliner"]]));
  await upsertEvents(v, "selectors", again, NOW, TZ);
  assert.equal((await db.list("acts")).length, 3);
  const evs2 = await db.list("venueEvents", (q) => q.where("venueId", "==", v));
  assert.equal(evs2.find((e) => e.sourceId === "s1")!.acts[0].actId, glock.id);
  const bro = (await actByName("The Brothers Comatose"))!;
  assert.equal(evs2.find((e) => e.sourceId === "s4")!.acts[0].actId, bro.id);
});

test("upsertEvents does not make an act of this band's own name", async () => {
  await db.create(ctx, "artists", { name: "The Moonlighters", slug: "moon", configurations: [], links: {}, driveFolderId: "" }, { id: TEST_ARTIST });
  const v = await makeVenue("Pine Hollow Lounge");
  await upsertEvents(v, "selectors", [draft("s1", "2026-11-20", [["Moonlighters", "headliner"], ["Denson", "support"]])], NOW, TZ);
  assert.deepEqual((await db.list("acts")).map((a) => a.name), ["Denson"]);
});

test("acts.find: rooms, next, openedAt, tour and the shortlist filter", async () => {
  const aggie = await makeVenue("Aggie Theatre", "Fort Collins");
  const blue = await makeVenue("Bluebird Theater", "Denver");
  const depot = await makeVenue("Depot", "Salt Lake City", "UT");
  // Aggie is "ours": the band has a note there.
  await cmd("venues.update", { id: aggie, patch: { loadInNotes: "Back door" } });

  await upsertEvents(aggie, "selectors", [
    draft("a1", "2026-09-01", [["Headliner Past", "headliner"], ["Denson", "support"]]),
    draft("a2", "2026-11-20", [["Denson", "headliner"]]),
  ], NOW, TZ);
  await upsertEvents(blue, "selectors", [draft("b1", "2026-12-01", [["Denson", "headliner"], ["Lonely Act", "support"]])], NOW, TZ);
  await upsertEvents(depot, "selectors", [draft("d1", "2026-11-25", [["Lonely Act", "headliner"]])], NOW, TZ);

  const all = await cmd("acts.find", { filter: "all" });
  assert.equal(all.count, 3);
  const denson = all.rows.find((r: any) => r.name === "Denson");
  assert.deepEqual(denson.rooms.map((r: any) => r.venueId).sort(), [aggie, blue].sort());
  assert.deepEqual(denson.rooms.find((r: any) => r.venueId === aggie).roles.slice().sort(), ["headliner", "support"]);
  assert.equal(denson.next.date, "2026-11-20");
  assert.equal(denson.next.venueId, aggie);
  assert.deepEqual(denson.openedAt, [aggie]);
  assert.deepEqual(denson.openedAtNames, ["Aggie Theatre"]);
  assert.equal(denson.tour, true, "Aggie 11/20 and Bluebird 12/1");
  assert.deepEqual(denson.cities.sort(), ["Denver", "Fort Collins"]);
  assert.equal(all.rows[0].name, "Denson", "soonest next show first");

  const lonely = all.rows.find((r: any) => r.name === "Lonely Act");
  assert.equal(lonely.tour, false, "one CO room plus Utah");
  assert.deepEqual(lonely.openedAt, [], "Bluebird is not ours");

  assert.equal((await cmd("acts.find", { filter: "opened" })).count, 1);
  assert.deepEqual((await cmd("acts.find", { filter: "tour" })).rows.map((r: any) => r.name), ["Denson"]);
  assert.equal((await cmd("acts.find", { city: "Salt Lake City" })).count, 1);
  assert.equal((await cmd("acts.find", { q: "lonely" })).count, 1);

  assert.equal((await cmd("acts.find", { filter: "shortlist" })).count, 0);
  await cmd("acts.shortlist", { id: lonely.id, on: true });
  const sl = await cmd("acts.find", { filter: "shortlist" });
  assert.deepEqual(sl.rows.map((r: any) => r.name), ["Lonely Act"]);
  assert.equal(sl.rows[0].shortlist, true);

  // Not a fit: hidden unless searched for.
  await cmd("acts.note", { id: lonely.id, relationship: "notFit" });
  assert.equal((await cmd("acts.find", { filter: "all" })).count, 2);
  assert.equal((await cmd("acts.find", { q: "lonely" })).count, 1);
});

test("another band's take on an act is not seen", async () => {
  const a = await cmd("acts.create", { name: "Denson", shortlist: true });
  const u2 = await makeUser("olga@example.com", "admin", { artistId: "other-artist" });
  const ctx2: Ctx = { uid: u2.uid, role: "admin", via: "app", runId: newRunId(), artistId: "other-artist" };
  const r = await cmd("acts.find", { filter: "all" }, ctx2);
  assert.equal(r.rows[0].id, a.id);
  assert.equal(r.rows[0].shortlist, false);
  assert.equal((await cmd("acts.find", { filter: "shortlist" }, ctx2)).count, 0);
});

// ---------- Look up (#78) ----------

test("acts.lookup A Brother's Fountain: web facts land, the made-up YouTube link does not, two Spotify artists ask 'same band?'", async () => {
  const a = await cmd("acts.create", { name: "A Brother's Fountain" });
  const r = await cmd("acts.lookup", { id: a.id });
  assert.equal(r.state, "pick");
  assert.equal(r.candidates, 2);
  const got = (await db.get("acts", a.id))! as Record<string, any>;
  assert.equal(got.links.website, "https://abrothersfountain.example/");
  assert.equal(got.links.instagram, "https://www.instagram.com/abrothersfountain/");
  assert.equal(got.links.bandcamp, "https://abrothersfountain.bandcamp.com/");
  assert.equal(got.links.youtube, undefined, "made-up link not stored");
  assert.equal(got.links.spotify, undefined, "not until someone picks");
  assert.equal(got.hometown, "Fort Collins, CO");
  assert.deepEqual(got.genres, ["folk", "americana"]);
  assert.match(got.description, /folk and Americana/);
  assert.equal(got.lookupCandidates.length, 2);
  assert.ok(got.lookedUpAt);
  assert.equal(got.imageUrl, undefined);

  // Pick the Colorado one.
  const p = await cmd("acts.lookup", { id: a.id, spotifyId: "4BrothersFountainCO01" });
  assert.equal(p.state, "found");
  const after = (await db.get("acts", a.id))! as Record<string, any>;
  assert.equal(after.links.spotify, "https://open.spotify.com/artist/4BrothersFountainCO01");
  assert.equal(after.imageUrl, "https://i.scdn.example/4BrothersFountainCO01-320.jpg");
  assert.ok(!after.lookupCandidates, "candidates cleared");
  assert.deepEqual(after.genres, ["folk", "americana"], "genres already set are kept");
  assert.equal(after.links.website, "https://abrothersfountain.example/");
  assert.ok(after.sources.some((s: any) => s.url === "https://open.spotify.com/artist/4BrothersFountainCO01"));
});

test("acts.lookup with spotifyId null: none of these, candidates cleared, the rest stays", async () => {
  const a = await cmd("acts.create", { name: "A Brother's Fountain" });
  await cmd("acts.lookup", { id: a.id });
  await cmd("acts.lookup", { id: a.id, spotifyId: null });
  const got = (await db.get("acts", a.id))! as Record<string, any>;
  assert.ok(!got.lookupCandidates);
  assert.equal(got.links.spotify, undefined);
  assert.equal(got.imageUrl, undefined);
  assert.equal(got.hometown, "Fort Collins, CO");
  assert.deepEqual(got.genres, ["folk", "americana"]);
  assert.equal(got.links.website, "https://abrothersfountain.example/");
});

test("acts.lookup North Fork Crossing: one Spotify match is taken straight away", async () => {
  const a = await cmd("acts.create", { name: "North Fork Crossing" });
  const r = await cmd("acts.lookup", { id: a.id });
  assert.equal(r.state, "found");
  const got = (await db.get("acts", a.id))! as Record<string, any>;
  assert.equal(got.links.spotify, "https://open.spotify.com/artist/NorthForkCrossing0001");
  assert.equal(got.imageUrl, "https://i.scdn.example/NorthForkCrossing0001-320.jpg");
  assert.ok(!got.genres || got.genres.length === 0, "Spotify gives no genres");
  assert.ok(got.lookedUpAt);
  assert.ok(!got.lookupCandidates);
  assert.ok(got.sources.some((s: any) => s.url === "https://open.spotify.com/artist/NorthForkCrossing0001"));
  assert.equal(got.hometown, undefined, "the fake web knows nothing of them");
});

test("acts.lookup Wheelwright: a Spotify artist with a different name is not used; only lookedUpAt is written", async () => {
  const a = await cmd("acts.create", { name: "Wheelwright" });
  const r = await cmd("acts.lookup", { id: a.id });
  assert.equal(r.state, "nothing");
  const got = (await db.get("acts", a.id))! as Record<string, any>;
  assert.ok(got.lookedUpAt);
  assert.ok(!got.links || Object.keys(got.links).length === 0);
  assert.ok(!got.genres || got.genres.length === 0);
  assert.equal(got.imageUrl, undefined);
  assert.equal(got.hometown, undefined);
  assert.equal(got.description, undefined);
  assert.ok(!got.lookupCandidates);
  assert.ok(!got.sources || got.sources.length === 0);
});

test("acts.lookup fills blanks only: what a person set stays", async () => {
  const a = await cmd("acts.create", { name: "A Brother's Fountain" });
  await cmd("acts.update", { id: a.id, patch: { hometown: "Boulder, CO", description: "Our friends.", genres: ["rock"] } });
  await cmd("acts.lookup", { id: a.id });
  const got = (await db.get("acts", a.id))! as Record<string, any>;
  assert.equal(got.hometown, "Boulder, CO");
  assert.equal(got.description, "Our friends.");
  assert.deepEqual(got.genres, ["rock"]);
  assert.equal(got.links.website, "https://abrothersfountain.example/", "blank links are still filled");
});

test("acts.lookup: an unknown id is not_found", async () => {
  await assert.rejects(cmd("acts.lookup", { id: "nope" }), (e: any) => e.code === "not_found");
  await assert.rejects(cmd("acts.lookup", { id: "nope", spotifyId: null }), (e: any) => e.code === "not_found");
});

test("acts.lookupShortlist looks up only shortlisted acts not yet looked up; a second call does nothing", async () => {
  const north = await cmd("acts.create", { name: "North Fork Crossing", shortlist: true });
  const wheel = await cmd("acts.create", { name: "Wheelwright", shortlist: true });
  const fountain = await cmd("acts.create", { name: "A Brother's Fountain", shortlist: true });
  const other = await cmd("acts.create", { name: "Denson" });
  const done = await cmd("acts.create", { name: "Already Done", shortlist: true });
  await db.update(ctx, "acts", done.id, { lookedUpAt: "2026-11-01T00:00:00.000Z" });

  const r = await cmd("acts.lookupShortlist", {});
  assert.equal(r.lookedUp, 3);
  assert.equal(r.found, 1);
  assert.equal(r.pick, 1);
  assert.equal(r.nothing, 1);
  assert.equal(r.failed, 0);
  assert.equal(r.left, 0);
  assert.ok((await db.get("acts", north.id))!.lookedUpAt);
  assert.ok((await db.get("acts", wheel.id))!.lookedUpAt);
  assert.ok((await db.get("acts", fountain.id))!.lookedUpAt);
  assert.equal((await db.get("acts", other.id))!.lookedUpAt, undefined, "not on the shortlist");
  assert.equal((await db.get("acts", done.id))!.lookedUpAt, "2026-11-01T00:00:00.000Z", "already looked up");

  const again = await cmd("acts.lookupShortlist", {});
  assert.equal(again.lookedUp, 0);
  assert.equal(again.left, 0);
});

// ---------- Find their team ----------

test("acts.findTeam: lists the team, saves nothing; Add makes a contact linked to the act; an unknown act finds no one", async () => {
  const a = await cmd("acts.create", { name: "A Brother's Fountain" });
  const r = await cmd("acts.findTeam", { id: a.id });
  assert.deepEqual(r.people.map((p: { role: string; email?: string; name?: string }) => [p.role, p.name ?? p.email]), [
    ["booking", "Dana Reyes"], ["management", "mgmt@abrothersfountain.example"], ["publicity", "Sam Ortiz"], ["general", "hello@abrothersfountain.example"],
  ]);
  // The search for Sam Ortiz found Sam's own email and LinkedIn on their PR firm's team page, not the colleague's.
  const sam = r.people[2];
  assert.equal(sam.email, "sam@ortizpr.example");
  assert.equal(sam.phone, "+13035550177");
  assert.deepEqual(sam.links, ["https://www.linkedin.com/in/sam-ortiz-pr", "https://ortizpr.example/team"]);
  assert.ok(!r.people.some((p: { email?: string }) => p.email === "sam@made-up-pr.example"), "made-up email dropped");
  // dedupeTeam folded "D. Reyes" into Dana Reyes and the press inbox (the address Sam's search found) into Sam, page and all.
  assert.equal(sam.source, "https://abrothersfountain.example/contact");
  assert.equal(r.people.filter((p: { email?: string }) => p.email === "sam@ortizpr.example").length, 1);
  assert.equal((await db.list("contacts")).length, 0, "nothing saved");
  const { teamContactInput } = await import("@/lib/acts");
  const c = await cmd("contacts.create", { ...teamContactInput(r.people[0], "A Brother's Fountain", "2026-11-11"), attachTo: { kind: "acts", id: a.id } });
  const saved = (await db.get("contacts", c.id))! as Record<string, any>;
  const note = (await db.list("contactNotes")).find((n) => n.contactId === c.id) as Record<string, any> | undefined;
  assert.match(note?.notes ?? "", /^Found by "Find their team" for A Brother's Fountain on 2026-11-11\. Booking agent for A Brother's Fountain at Front Range Touring: named on abrothersfountain\.example/);
  const s = await cmd("contacts.create", { ...teamContactInput(sam, "A Brother's Fountain", "2026-11-11"), attachTo: { kind: "acts", id: a.id } });
  assert.deepEqual(((await db.get("contacts", s.id))! as Record<string, any>).links, sam.links);
  assert.equal(saved.title, "Booking agent, Front Range Touring");
  assert.deepEqual(saved.phones, ["+19705550142"]);
  assert.deepEqual((await take(a.id))!.contactIds, [c.id, s.id]);

  const other = await cmd("acts.create", { name: "Nobody Knows Us" });
  assert.deepEqual((await cmd("acts.findTeam", { id: other.id })).people, []);
  await assert.rejects(cmd("acts.findTeam", { id: "nope" }), /No act/);
});
