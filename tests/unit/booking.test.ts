import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { dispatch } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { gmailClient } from "@/server/integrations";
import { fillTemplate, unfilledFields, buildTemplateContext, buildSearchItems, searchItems, appsOpenThisMonth, upcomingDeadlines } from "@/lib/booking";
import { firestore } from "@/server/admin";
import { migratePitchedAs } from "../../scripts/migrate-pitched-as";
import { migratePitchDates } from "../../scripts/migrate-pitch-dates";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx;
let uid: string;
let token: string;
let mids: string[];
let artistId: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.GMAIL_BASE_URL = s.running["fake-gmail"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

beforeEach(async () => {
  await resetEmulators();
  const u = await makeUser("jeff@example.com", "admin", { name: "Jeff Smith" });
  uid = u.uid; token = u.token;
  ctx = { uid, role: "admin", via: "app", runId: newRunId() };
  mids = [];
  for (const n of ["Ingrid", "Jeff", "David"]) mids.push((await db.create(ctx, "musicians", { name: n, instruments: [], active: true })).id);
  artistId = (await db.create(ctx, "artists", {
    slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: { website: "https://band.example" },
    configurations: [
      { id: "trio", name: "Trio", billingName: "Trio", musicianIds: mids },
      { id: "duo", name: "Duo", billingName: "Duo", musicianIds: mids.slice(0, 2) },
    ],
  }, { id: TEST_ARTIST })).id;
});

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};

test("pure helpers: fill, unfilled, context, search, application dates", () => {
  assert.equal(fillTemplate("Hi {{contact.firstName}} at {{ venue.name }} {{nope}}", { "contact.firstName": "Haylee", "venue.name": "Lost Lake" }), "Hi Haylee at Lost Lake {{nope}}");
  assert.deepEqual(unfilledFields("{{a}} {{b.c}} {{a}}"), ["a", "b.c"]);
  const c = buildTemplateContext({ target: { kind: "venue", name: "Lost Lake" }, contact: { name: "Haylee Jackson" }, user: { name: "Jeff Smith" } });
  assert.equal(c["venue.name"], "Lost Lake");
  assert.equal(c["contact.firstName"], "Haylee");
  assert.equal(c["user.firstName"], "Jeff");
  const items = buildSearchItems({
    venues: [{ id: "v1", name: "Lost Lake", address: { city: "Denver" }, contactIds: ["c1"] }, { id: "v2", name: "Fox", address: { city: "Boulder" }, contactIds: [] }],
    promoters: [], festivals: [], contacts: [{ id: "c1", name: "Haylee Jackson", emails: ["h@x.com"] }],
  });
  assert.deepEqual(searchItems(items, "denver").map((i) => i.id), ["v1"]);
  assert.deepEqual(searchItems(items, "haylee").map((i) => i.id).sort(), ["c1", "v1"]);
  assert.equal(searchItems(items, "boulder fox").length, 1);
  const eds = [
    { id: "a", appOpens: { date: "2026-10-30" }, appDeadline: { date: "2027-01-15" } },
    { id: "b", appOpens: { date: "2026-12-01" } }, { id: "c", appOpens: { date: "2026-09-01" }, appDeadline: { date: "2026-10-01" } },
    { id: "d", appOpens: { date: "2026-09-01" }, appDeadline: { date: "2026-11-01" } },
  ];
  assert.deepEqual(appsOpenThisMonth(eds, "2026-10-23").map((e) => e.id), ["a", "d"]);
  assert.deepEqual(upcomingDeadlines(eds, "2026-10-23", 30).map((e) => e.id), ["d"]);
});

test("dedupe: venue, promoter, festival and contact creates merge instead of duplicating", async () => {
  const a = await cmd("venues.create", venue("Lost Lake Lounge"));
  const b = await cmd("venues.create", venue("lost lake lounge", "Denver", { capacity: 300 }));
  assert.equal(b.merged, true);
  assert.equal(b.id, a.id);
  assert.equal((await db.get("venues", a.id))!.capacity, 300);
  assert.equal((await db.list("venues")).length, 1);
  assert.notEqual((await cmd("venues.create", venue("Lost Lake Lounge", "Boulder"))).id, a.id);

  const p1 = await cmd("promoters.create", { name: "Front Range Presents", kind: "promoter" });
  assert.equal((await cmd("promoters.create", { name: "Front-Range Presents", kind: "promoter", website: "https://x.example" })).id, p1.id);
  const f1 = await cmd("festivals.create", { name: "UMS", type: "festival", region: "denver" });
  assert.equal((await cmd("festivals.create", { name: "ums", type: "festival", region: "denver" })).merged, true);
  assert.ok(f1.id);
  const c1 = await cmd("contacts.create", { name: "Haylee", emails: ["Haylee@x.com"] });
  const c2 = await cmd("contacts.create", { name: "Haylee J", emails: ["haylee@x.com"], phones: ["+13035550101"] });
  assert.equal(c2.id, c1.id);
  assert.deepEqual((await db.get("contacts", c1.id))!.phones, ["+13035550101"]);
  const hist = await db.listGroup("history", (q) => q.where("entity.id", "==", c1.id));
  assert.ok(hist.some((h) => h.op === "merge"));
});

test("contacts attach to places, detach, and archive unlinks (a venue's links are the band's private notes)", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const c = await cmd("contacts.create", { name: "Haylee", emails: ["h@x.com"], attachTo: { kind: "venues", id: v.id } });
  const noteId = `${TEST_ARTIST}__${v.id}`;
  assert.deepEqual((await db.get("venueNotes", noteId))!.contactIds, [c.id]);
  assert.equal((await db.get("venues", v.id))!.contactIds, undefined, "nothing private on the shared venue");
  await cmd("contacts.detach", { contactId: c.id, kind: "venues", id: v.id });
  assert.deepEqual((await db.get("venueNotes", noteId))!.contactIds, []);
  await cmd("contacts.attach", { contactId: c.id, kind: "venues", id: v.id });
  await cmd("contacts.remove", { id: c.id });
  assert.deepEqual((await db.get("venueNotes", noteId))!.contactIds, []);
});

test("venue promoter links stay in sync both ways, in the band's own notes", async () => {
  const p = await cmd("promoters.create", { name: "Promo", kind: "promoter" });
  const v = await cmd("venues.create", venue("Room", "Denver", { promoterIds: [p.id] }));
  const pn = async () => (await db.get("promoterNotes", `${TEST_ARTIST}__${p.id}`))?.venueIds ?? null;
  assert.deepEqual(await pn(), [v.id]);
  assert.equal("venueIds" in (await db.get("promoters", p.id))!, false, "the shared promoter does not say which venues this band books there");
  assert.deepEqual((await db.get("venueNotes", `${TEST_ARTIST}__${v.id}`))!.promoterIds, [p.id]);
  await cmd("venues.update", { id: v.id, patch: { promoterIds: [] } });
  assert.equal(await pn(), null);
  // and from the promoter's side
  await cmd("promoters.update", { id: p.id, patch: { venueIds: [v.id] } });
  assert.deepEqual((await db.get("venueNotes", `${TEST_ARTIST}__${v.id}`))!.promoterIds, [p.id]);
  await cmd("promoters.update", { id: p.id, patch: { venueIds: [] } });
  assert.deepEqual((await db.get("venueNotes", `${TEST_ARTIST}__${v.id}`))!.promoterIds, []);
});

test("a patch leaves the fields it does not name alone (no create defaults)", async () => {
  const c = await cmd("contacts.create", { name: "Ann", emails: ["a@x.com"], phones: ["+13035550101"] });
  await cmd("contacts.update", { id: c.id, patch: { title: "Buyer" } });
  const after = (await db.get("contacts", c.id))!;
  assert.deepEqual([after.emails, after.phones], [["a@x.com"], ["+13035550101"]]);
  const p = await cmd("promoters.create", { name: "Promo", kind: "promoter", contactIds: [c.id] });
  await cmd("promoters.update", { id: p.id, patch: { website: "https://promo.example" } });
  assert.deepEqual((await db.get("promoters", p.id))!.contactIds, [c.id]);
});

// ---------- venues: shared directory + private per-band notes ----------

const OTHER = "other-band";
const asOther = (): Ctx => ({ ...ctx, artistId: OTHER, runId: newRunId() });
const asMember = (): Ctx => ({ uid: "member-uid", role: "member", via: "app", runId: newRunId(), artistId: TEST_ARTIST });
const noteDoc = (artist: string, venueId: string) => db.get("venueNotes", `${artist}__${venueId}`);
const run_ = (name: string, input: unknown, c: Ctx) => cmd(name, input, c);

test("venues.create splits one input across the shared room and the band's private notes", async () => {
  const p = await cmd("promoters.create", { name: "Promo", kind: "promoter" });
  const c = await cmd("contacts.create", { name: "Haylee", emails: ["h@x.com"] });
  const r = await cmd("venues.create", venue("Hi-Dive", "Denver", { capacity: 250, loadInNotes: "Alley door", notes: "Ask for Sam", contactIds: [c.id], promoterIds: [p.id] }));
  const shared = (await db.get("venues", r.id))!;
  assert.equal(shared.capacity, 250);
  for (const f of ["loadInNotes", "notes", "contactIds", "promoterIds"]) assert.equal(f in shared, false, `${f} is not on the shared room`);
  const note = (await noteDoc(TEST_ARTIST, r.id))!;
  assert.deepEqual([note.artistId, note.venueId, note.loadInNotes, note.notes, note.contactIds, note.promoterIds], [TEST_ARTIST, r.id, "Alley door", "Ask for Sam", [c.id], [p.id]]);
  const hist = await db.listGroup("history", (q) => q.where("runId", "==", ctx.runId));
  assert.ok(hist.some((h) => h.entity.kind === "venues") && hist.some((h) => h.entity.kind === "venueNotes"), "one run covers both docs");
  // a room with nothing private makes no notes doc
  const plain = await cmd("venues.create", venue("Plain"));
  assert.equal(await noteDoc(TEST_ARTIST, plain.id), null);
});

test("venues.update: shared fields go to the room, private ones to the band's notes, and the notes doc is created on first write", async () => {
  const v = await cmd("venues.create", venue("Fox"));
  assert.equal(await noteDoc(TEST_ARTIST, v.id), null);
  await cmd("venues.update", { id: v.id, patch: { capacity: 600, loadInNotes: "Dock on 14th" } });
  assert.equal((await db.get("venues", v.id))!.capacity, 600);
  assert.equal((await noteDoc(TEST_ARTIST, v.id))!.loadInNotes, "Dock on 14th");
  await cmd("venues.update", { id: v.id, patch: { loadInNotes: null } });
  assert.equal("loadInNotes" in (await noteDoc(TEST_ARTIST, v.id))!, false);
  // a different band's notes are separate
  await run_("venues.update", { id: v.id, patch: { notes: "their own" } }, asOther());
  assert.equal((await noteDoc(OTHER, v.id))!.notes, "their own");
  assert.equal((await noteDoc(TEST_ARTIST, v.id))!.notes, undefined);
});

test("a member edits the shared room but is refused private fields (403 naming them)", async () => {
  const v = await cmd("venues.create", venue("Fox"));
  await run_("venues.update", { id: v.id, patch: { capacity: 700 } }, asMember());
  assert.equal((await db.get("venues", v.id))!.capacity, 700);
  const made = await run_("venues.create", venue("Member Found It", "Boulder"), asMember());
  assert.ok((await db.get("venues", made.id))!);
  assert.equal(await noteDoc(TEST_ARTIST, made.id), null, "a member leaves no notes");
  for (const [name, input] of [
    ["venues.update", { id: v.id, patch: { notes: "x", capacity: 1 } }],
    ["venues.update", { id: v.id, patch: { contactIds: [] } }],
    ["venues.create", venue("Sneaky", "Denver", { loadInNotes: "x" })],
  ] as [string, unknown][]) {
    await assert.rejects(run_(name, input, asMember()), (e: { status: number; message: string }) => e.status === 403 && /notes|contactIds|loadInNotes/.test(e.message));
  }
  assert.equal((await db.get("venues", v.id))!.capacity, 700, "a refused call writes nothing");
  // over HTTP: members may run venues.create/update but not remove or merge
  const m = await makeUser("mem@example.com", "member", { name: "Mem" });
  assert.equal((await dispatch("venues.update", `Bearer ${m.token}`, { id: v.id, patch: { capacity: 710 } })).status, 200);
  assert.equal((await dispatch("venues.update", `Bearer ${m.token}`, { id: v.id, patch: { notes: "no" } })).status, 403);
  assert.equal((await dispatch("venues.remove", `Bearer ${m.token}`, { id: v.id })).status, 403);
  assert.equal((await dispatch("venues.mergeInto", `Bearer ${m.token}`, { from: v.id, into: made.id })).status, 403);
});

test("venues.remove hides the room for this band only; adding it again brings it back", async () => {
  const v = await cmd("venues.create", venue("Gone For Us", "Denver", { notes: "ours" }));
  await run_("venues.update", { id: v.id, patch: { notes: "theirs" } }, asOther());
  await cmd("venues.remove", { id: v.id });
  assert.equal((await db.get("venues", v.id))!.deletedAt, null, "the shared room stays");
  assert.ok((await noteDoc(TEST_ARTIST, v.id))!.deletedAt, "this band's notes are archived");
  assert.equal((await noteDoc(OTHER, v.id))!.deletedAt, null, "the other band is untouched");
  // the band's list hides it, the other band's keeps it
  const mine = await cmd("records.list", { kind: "venues" }), theirs = await run_("records.list", { kind: "venues" }, asOther());
  assert.equal(mine.rows.some((r: { id: string }) => r.id === v.id), false);
  assert.equal(theirs.rows.some((r: { id: string }) => r.id === v.id), true);
  // a room nobody wrote notes for can be hidden too
  const bare = await cmd("venues.create", venue("Bare"));
  await cmd("venues.remove", { id: bare.id });
  assert.ok((await noteDoc(TEST_ARTIST, bare.id))!.deletedAt);
  // adding it again (same name and city) is the same room, back on the list with its old notes
  const again = await cmd("venues.create", venue("Gone For Us", "Denver"));
  assert.equal(again.id, v.id);
  assert.equal((await noteDoc(TEST_ARTIST, v.id))!.deletedAt, null);
  assert.equal((await noteDoc(TEST_ARTIST, v.id))!.notes, "ours");
  // Undo of the remove brings it back too
  const rm = { ...ctx, runId: newRunId() };
  await cmd("venues.remove", { id: v.id }, rm);
  assert.ok((await noteDoc(TEST_ARTIST, v.id))!.deletedAt);
  const { undoRun } = await import("@/server/undo");
  await undoRun(ctx, rm.runId);
  assert.equal((await noteDoc(TEST_ARTIST, v.id))!.deletedAt, null);
});

test("records.get and records.list show the shared room plus only the caller's band's notes", async () => {
  const v = await cmd("venues.create", venue("Fox", "Boulder", { notes: "ours", loadInNotes: "front" }));
  await run_("venues.update", { id: v.id, patch: { notes: "theirs" } }, asOther());
  const mine = await cmd("records.get", { kind: "venues", id: v.id }), theirs = await run_("records.get", { kind: "venues", id: v.id }, asOther());
  assert.deepEqual([mine.notes, mine.loadInNotes], ["ours", "front"]);
  assert.deepEqual([theirs.notes, theirs.loadInNotes], ["theirs", undefined]);
  assert.deepEqual(theirs.contactIds, []);
  const list = await run_("records.list", { kind: "venues" }, asOther());
  assert.equal(list.rows.find((r: { id: string }) => r.id === v.id).notes, "theirs");
});

test("venues.mergeInto: moves every band's shows, pitches and notes, fills the survivor, archives the duplicate, one Undo", async () => {
  const promo = await cmd("promoters.create", { name: "Promo", kind: "promoter" });
  const c1 = await cmd("contacts.create", { name: "Ann", emails: ["a@x.com"] }), c2 = await cmd("contacts.create", { name: "Bo", emails: ["b@x.com"] });
  const keep = await cmd("venues.create", venue("Hi-Dive", "Denver", { capacity: 250, notes: "keep notes", contactIds: [c1.id] }));
  const dup = await cmd("venues.create", venue("The Hi-Dive", "Denver", { capacity: 999, website: "https://hidive.example", notes: "dup notes", contactIds: [c2.id], loadInNotes: "back door", promoterIds: [promo.id] }));
  await run_("venues.update", { id: dup.id, patch: { notes: "other band's secret", contactIds: [c1.id] } }, asOther());
  const pitch = await cmd("pitches.flag", { kind: "venue", id: dup.id });
  const show = await db.create(ctx, "shows", {
    date: "2027-01-01", status: "confirmed", venue: { id: dup.id, name: "The Hi-Dive", address: "Denver", city: "Denver" }, times: {}, artistId: TEST_ARTIST, personnel: [],
    sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, checklist: [], gear: [], docs: [], listings: {},
  });
  const m = asOther(); // a different band's admin merges: allowed, and it moves everyone's records
  const res = await run_("venues.mergeInto", { from: dup.id, into: keep.id }, m);
  assert.equal(JSON.stringify(res).includes("secret"), false, "no band's private content comes back");
  assert.equal(res.moved.shows, 1); assert.equal(res.moved.pitches, 1);
  // references moved
  assert.deepEqual((await db.get("shows", show.id))!.venue, { id: keep.id, name: "Hi-Dive", address: "Denver", city: "Denver" });
  assert.deepEqual([(await db.get("pitches", pitch.id))!.target.id, (await db.get("pitches", pitch.id))!.target.name], [keep.id, "Hi-Dive"]);
  assert.deepEqual((await db.get("promoterNotes", `${TEST_ARTIST}__${promo.id}`))!.venueIds, [keep.id]);
  // each band's notes joined onto its notes for the survivor; the other band's stay its own
  const mine = (await noteDoc(TEST_ARTIST, keep.id))!, theirs = (await noteDoc(OTHER, keep.id))!;
  assert.equal(mine.notes, "keep notes\n\ndup notes"); assert.equal(mine.loadInNotes, "back door");
  assert.deepEqual(mine.contactIds.sort(), [c1.id, c2.id].sort()); assert.deepEqual(mine.promoterIds, [promo.id]);
  assert.equal(theirs.notes, "other band's secret"); assert.deepEqual(theirs.contactIds, [c1.id]);
  assert.ok((await noteDoc(TEST_ARTIST, dup.id))!.deletedAt && (await noteDoc(OTHER, dup.id))!.deletedAt, "the duplicate's notes are archived");
  // survivor: existing wins, empty fields filled; the duplicate points at it and is archived
  const k = (await db.get("venues", keep.id))!;
  assert.deepEqual([k.capacity, k.website], [250, "https://hidive.example"]);
  const d = (await db.get("venues", dup.id))!;
  assert.deepEqual([d.mergedInto, !!d.deletedAt], [keep.id, true]);
  // one run, one Undo
  const { undoRun } = await import("@/server/undo");
  const rep = await undoRun(ctx, m.runId);
  assert.equal(rep.failed.length, 0);
  assert.deepEqual((await db.get("shows", show.id))!.venue.id, dup.id);
  assert.equal((await db.get("pitches", pitch.id))!.target.id, dup.id);
  assert.equal((await db.get("venues", dup.id))!.deletedAt, null);
  assert.equal((await db.get("venues", dup.id))!.mergedInto, undefined);
  assert.equal((await db.get("venues", keep.id))!.website, undefined);
  assert.equal((await noteDoc(TEST_ARTIST, keep.id))!.notes, "keep notes");
  assert.equal((await noteDoc(OTHER, dup.id))!.notes, "other band's secret");
  assert.deepEqual((await db.get("promoterNotes", `${TEST_ARTIST}__${promo.id}`))!.venueIds, [dup.id]);
  // refused: same venue, a merged-away venue
  await assert.rejects(cmd("venues.mergeInto", { from: keep.id, into: keep.id }), (e: { status: number }) => e.status === 400);
  await cmd("venues.mergeInto", { from: dup.id, into: keep.id });
  await assert.rejects(cmd("venues.mergeInto", { from: keep.id, into: dup.id }), (e: { status: number }) => e.status === 404);
});

test("shows.create seeds the deal's contacts from the band's venue notes, not another band's", async () => {
  const c = await cmd("contacts.create", { name: "Ann", emails: ["a@x.com"] });
  const o = await cmd("contacts.create", { name: "Other", emails: ["o@x.com"] });
  const v = await cmd("venues.create", venue("Fox", "Boulder", { contactIds: [c.id] }));
  await run_("venues.update", { id: v.id, patch: { contactIds: [o.id] } }, asOther());
  const s = await cmd("shows.create", { venueId: v.id, date: "2027-02-02" });
  assert.deepEqual((await db.get("showDeals", s.id))!.contactIds, [c.id]);
});

test("pitches.flag on a venue gives the band a notes doc, so the room is theirs", async () => {
  const v = await cmd("venues.create", venue("Flagged"));
  assert.equal(await noteDoc(TEST_ARTIST, v.id), null);
  await cmd("pitches.flag", { kind: "venue", id: v.id });
  assert.ok(await noteDoc(TEST_ARTIST, v.id));
});

test("a venue not yet migrated (private fields still on the doc) reads, updates and links without losing them", async () => {
  // As written before the split, straight to the database.
  const v = await db.create(ctx, "venues", venue("Old Room", "Denver", { notes: "old notes", loadInNotes: "old dock", contactIds: ["c-old"], promoterIds: [] }));
  const got = await cmd("records.get", { kind: "venues", id: v.id });
  assert.deepEqual([got.notes, got.loadInNotes, got.contactIds], ["old notes", "old dock", ["c-old"]]);
  await cmd("venues.update", { id: v.id, patch: { capacity: 120 } }); // shared edit on a strict doc with legacy fields: no failure
  assert.equal((await db.get("venues", v.id))!.capacity, 120);
  assert.equal((await db.get("venues", v.id))!.notes, "old notes", "the legacy fields are left for the migration");
  // the first private write starts from the legacy values
  await cmd("venues.update", { id: v.id, patch: { notes: "new notes" } });
  const n = (await noteDoc(TEST_ARTIST, v.id))!;
  assert.deepEqual([n.notes, n.loadInNotes, n.contactIds], ["new notes", "old dock", ["c-old"]]);
  // a show booked here takes its contacts from the legacy link too
  const v2 = await db.create(ctx, "venues", venue("Old Room 2", "Denver", { contactIds: ["c-old2"], promoterIds: [] }));
  const s = await cmd("shows.create", { venueId: v2.id, date: "2027-03-03" });
  assert.deepEqual((await db.get("showDeals", s.id))!.contactIds, ["c-old2"]);
});

test("renames keep denormalized names in sync (venue -> pitch, festival -> edition -> pitch)", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const pv = await cmd("pitches.flag", { kind: "venue", id: v.id });
  const f = await cmd("festivals.create", { name: "UMS", type: "festival", region: "denver" });
  const e = await cmd("editions.create", { festivalId: f.id, year: 2027, label: "2027" });
  assert.equal((await db.get("editions", e.id))!.festivalName, "UMS");
  const pe = await cmd("pitches.flag", { kind: "edition", id: e.id });
  assert.equal((await db.get("pitches", pe.id))!.target.name, "UMS 2027");
  await cmd("venues.update", { id: v.id, patch: { name: "Lost Lake Lounge" } });
  assert.equal((await db.get("pitches", pv.id))!.target.name, "Lost Lake Lounge");
  await cmd("festivals.update", { id: f.id, patch: { name: "Underground Music Showcase" } });
  assert.equal((await db.get("editions", e.id))!.festivalName, "Underground Music Showcase");
  assert.equal((await db.get("pitches", pe.id))!.target.name, "Underground Music Showcase 2027");
  await cmd("editions.update", { id: e.id, patch: { label: "Summer 2027" } });
  assert.equal((await db.get("pitches", pe.id))!.target.name, "Underground Music Showcase Summer 2027");
});

test("flag: adds to the Pitch List once, fills personnel from the configuration", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const a = await cmd("pitches.flag", { kind: "venue", id: v.id });
  assert.equal(a.existing, false);
  const p = (await db.get("pitches", a.id))!;
  assert.equal(p.status, "toPitch");
  assert.equal(p.assigneeId, uid);
  assert.equal(p.artistId, artistId);
  assert.deepEqual(p.personnel, []);
  assert.equal((await cmd("pitches.flag", { kind: "venue", id: v.id })).existing, true);
  assert.equal((await db.list("pitches")).length, 1);
  const b = await cmd("pitches.flag", { kind: "venue", id: (await cmd("venues.create", venue("Fox", "Boulder"))).id, pitchedAs: "duo" });
  assert.deepEqual((await db.get("pitches", b.id))!.personnel, mids.slice(0, 2));
  const acts = await db.list(`pitches/${a.id}/activity`);
  assert.equal(acts[0].text, "Added to Pitch List");
  await assert.rejects(cmd("pitches.flag", { kind: "venue", id: "nope" }), /not found/);
  // after a decline the same place can be flagged again
  await cmd("pitches.move", { id: a.id, status: "declined" });
  assert.equal((await cmd("pitches.flag", { kind: "venue", id: v.id })).existing, false);
});

test("pitch edits: configuration fills personnel but stays editable; next step, assignee, not sure", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const { id } = await cmd("pitches.flag", { kind: "venue", id: v.id });
  await cmd("pitches.update", { id, patch: { pitchedAs: "trio" } });
  assert.deepEqual((await db.get("pitches", id))!.personnel, mids);
  await cmd("pitches.update", { id, patch: { personnel: [mids[0]] } });
  assert.deepEqual((await db.get("pitches", id))!.personnel, [mids[0]]);
  await cmd("pitches.update", { id, patch: { nextStep: { text: "Follow up", due: "2026-11-03" } } });
  assert.deepEqual((await db.get("pitches", id))!.nextStep, { text: "Follow up", due: "2026-11-03" });
  await cmd("pitches.update", { id, patch: { nextStep: null, pitchedAs: null } });
  const p = (await db.get("pitches", id))!;
  assert.equal(p.nextStep, undefined);
  assert.equal(p.pitchedAs, undefined);
  await assert.rejects(cmd("pitches.update", { id, patch: { pitchedAs: "orchestra" } }), /configuration/);
  await assert.rejects(cmd("pitches.update", { id, patch: { assigneeId: "ghost" } }), /Assignee/);
});

test("move logs status activity; comments and notes go on the timeline", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const { id } = await cmd("pitches.flag", { kind: "venue", id: v.id });
  assert.equal((await cmd("pitches.move", { id, status: "toPitch" })).changed, false);
  await cmd("pitches.move", { id, status: "pitched" });
  await cmd("pitches.comment", { id, body: "Mention the Roots show" });
  await cmd("pitches.log", { id, type: "call", text: "Left a voicemail" });
  assert.equal((await db.get("pitches", id))!.status, "pitched");
  assert.ok((await db.get("pitches", id))!.lastContactAt);
  const acts = await db.list(`pitches/${id}/activity`);
  assert.ok(acts.some((a) => a.type === "status" && a.fromStatus === "toPitch" && a.toStatus === "pitched"));
  await assert.rejects(cmd("pitches.move", { id, status: "waiting" }), "waiting was merged into pitched");
  assert.ok(acts.some((a) => a.type === "call"));
  const comments = await db.list(`pitches/${id}/comments`);
  assert.equal(comments[0].authorId, uid);
  await assert.rejects(cmd("pitches.move", { id, status: "bogus" }));
});

test("email: send logs emailSent, sets lastContactAt, shows in Gmail; unfilled fields refused; replies are pulled once", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const { id } = await cmd("pitches.flag", { kind: "venue", id: v.id });
  await assert.rejects(cmd("pitches.sendEmail", { id, to: ["h@lostlake.example"], subject: "Hi {{contact.firstName}}", body: "x" }), /Fill in/);
  assert.equal((await gmailClient().listMessages()).length, 0);
  const sent = await cmd("pitches.sendEmail", { id, to: ["h@lostlake.example"], subject: "Support slot", body: "Hi Haylee", markPitched: true });
  const msgs = await gmailClient().listMessages({ account: "jeff@example.com" });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].subject, "Support slot");
  assert.deepEqual(msgs[0].to, ["h@lostlake.example"]);
  const p = (await db.get("pitches", id))!;
  assert.ok(p.lastContactAt);
  assert.equal(p.status, "pitched");
  const act = (await db.list(`pitches/${id}/activity`)).find((a) => a.type === "emailSent")!;
  assert.equal(act.gmail.threadId, sent.threadId);
  assert.equal(act.gmail.subject, "Support slot");

  assert.equal((await cmd("pitches.checkReplies", { id })).added, 0);
  await gmailClient().simulateReply!(sent.threadId, { from: "h@lostlake.example", body: "Sounds great, send dates." });
  assert.equal((await cmd("pitches.checkReplies", { id })).added, 1);
  assert.equal((await cmd("pitches.checkReplies", { id })).added, 0);
  const reply = (await db.list(`pitches/${id}/activity`)).find((a) => a.type === "emailReply")!;
  assert.match(reply.text, /Sounds great/);
});

test("email templates CRUD and admin-only access over the command API", async () => {
  const t = await cmd("emailTemplates.create", { name: "First pitch", subject: "{{venue.name}}", body: "Hi {{contact.firstName}}" });
  await cmd("emailTemplates.update", { id: t.id, patch: { subject: "Hello {{venue.name}}" } });
  assert.equal((await db.get("emailTemplates", t.id))!.subject, "Hello {{venue.name}}");
  assert.deepEqual((await db.get("emailTemplates", t.id))!.targetKinds, []);
  await cmd("emailTemplates.remove", { id: t.id });
  assert.equal((await db.list("emailTemplates")).length, 0);
  const member = await makeUser("m@example.com", "member");
  assert.equal((await dispatch("promoters.create", `Bearer ${member.token}`, { name: "X", kind: "promoter" })).status, 403);
  assert.equal((await dispatch("venues.create", `Bearer ${member.token}`, venue("X"))).status, 200, "the venue directory is open to members");
  assert.equal((await dispatch("pitches.flag", `Bearer ${token}`, { kind: "venue", id: "nope" })).status, 404);
});

test("migrate-pitched-as: free text matches a configuration by name, otherwise moves to notes; dry run writes nothing; second run is a no-op", async () => {
  const mk = async (name: string, pitchedAs?: string, notes?: string) => {
    const { id } = await cmd("pitches.flag", { kind: "venue", id: (await cmd("venues.create", venue(name))).id, ...(notes ? { notes } : {}) });
    if (pitchedAs !== undefined) await firestore().doc(`pitches/${id}`).update({ pitchedAs });
    return id;
  };
  const duo = await mk("A", " duo ");           // name match, case-insensitive, trimmed
  const trio = await mk("B", "trio");           // already a configuration id: left alone
  const odd = await mk("C", "Acoustic ish", "Loves folk");
  const bare = await mk("D", "Solo");
  const fine = await mk("E");
  await cmd("pitches.update", { id: fine, patch: { pitchedAs: "duo" } });
  const gone = await mk("F", "Quartet");
  await firestore().doc(`pitches/${gone}`).update({ deletedAt: new Date() });

  const dry = await migratePitchedAs(firestore(), { dryRun: true });
  assert.deepEqual(dry.matched.map((m) => m.id), [duo]);
  assert.deepEqual(dry.cleared.map((c) => c.id).sort(), [odd, bare, gone].sort());
  assert.equal((await db.get("pitches", duo))!.pitchedAs, " duo ", "dry run writes nothing");

  await migratePitchedAs(firestore());
  assert.equal((await db.get("pitches", duo))!.pitchedAs, "duo");
  assert.equal((await db.get("pitches", trio))!.pitchedAs, "trio");
  const o = (await db.get("pitches", odd))!;
  assert.equal(o.pitchedAs, undefined);
  assert.equal(o.notes, "Loves folk\nPitched as: Acoustic ish");
  assert.equal((await db.get("pitches", bare))!.notes, "Pitched as: Solo");
  assert.equal((await db.get("pitches", fine))!.pitchedAs, "duo");
  const g = (await firestore().doc(`pitches/${gone}`).get()).data()!;
  assert.equal("pitchedAs" in g, false);
  assert.equal(g.notes, "Pitched as: Quartet");

  const again = await migratePitchedAs(firestore());
  assert.deepEqual([again.matched, again.cleared], [[], []]);
});

test("pitch dates: plain date strings; flag and update accept a list, stored sorted and unique; bad dates and the old object shape rejected", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const a = await cmd("pitches.flag", { kind: "venue", id: v.id, dates: ["2027-02-06", "2027-01-16", "2027-02-06"] });
  assert.deepEqual((await db.get("pitches", a.id))!.dates, ["2027-01-16", "2027-02-06"]);
  await cmd("pitches.update", { id: a.id, patch: { dates: ["2027-07-25", "2027-03-01"] } });
  assert.deepEqual((await db.get("pitches", a.id))!.dates, ["2027-03-01", "2027-07-25"]);
  await assert.rejects(cmd("pitches.update", { id: a.id, patch: { dates: [{ date: "2027-03-05" }] } }));
  await assert.rejects(cmd("pitches.update", { id: a.id, patch: { dates: ["March 5"] } }), /YYYY-MM-DD/);
  assert.equal((await db.get("pitches", a.id))!.dates.length, 2, "a rejected edit changes nothing");
  await cmd("pitches.update", { id: a.id, patch: { notes: "only notes" } });
  assert.equal((await db.get("pitches", a.id))!.dates.length, 2, "other edits leave dates alone");
  await cmd("pitches.update", { id: a.id, patch: { dates: [] } });
  assert.deepEqual((await db.get("pitches", a.id))!.dates, []);
  const b = await cmd("pitches.flag", { kind: "venue", id: (await cmd("venues.create", venue("Fox", "Boulder"))).id });
  assert.deepEqual((await db.get("pitches", b.id))!.dates, []);
});

test("migrate-pitch-dates: {date, endDate, note} becomes sorted unique strings, lost ranges and notes go to the pitch notes; dry run writes nothing; second run is a no-op", async () => {
  const v = await cmd("venues.create", venue("Old Dates"));
  const a = await cmd("pitches.flag", { kind: "venue", id: v.id });
  const fs = firestore();
  const old = [{ date: "2027-02-06", note: "hold" }, { date: "2027-01-16" }, { date: "2027-07-25", endDate: "2027-07-27" }, { date: "2027-01-16" }];
  await fs.collection("pitches").doc(a.id).update({ dates: old, notes: "keep me" });
  const dry = await migratePitchDates(fs, { dryRun: true });
  assert.equal(dry.migrated.length, 1);
  assert.deepEqual((await fs.collection("pitches").doc(a.id).get()).data()!.dates, old);
  await migratePitchDates(fs);
  const after = (await db.get("pitches", a.id))!;
  assert.deepEqual(after.dates, ["2027-01-16", "2027-02-06", "2027-07-25"]);
  assert.equal(after.notes, "keep me\nDates: 2027-02-06 (hold), 2027-07-25 to 2027-07-27");
  assert.deepEqual((await migratePitchDates(fs)).migrated, []);
});
