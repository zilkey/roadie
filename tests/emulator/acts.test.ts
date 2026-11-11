import { test, beforeEach } from "node:test";
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
