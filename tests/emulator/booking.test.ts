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
import { firestore } from "@/server/admin";
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
  const u = await makeUser("rudy@example.com", "admin", { name: "Rudy Smith" });
  uid = u.uid; token = u.token;
  ctx = { uid, role: "admin", via: "app", runId: newRunId() };
  mids = [];
  for (const n of ["Nora", "Rudy", "Hugo"]) mids.push((await db.create(ctx, "musicians", { name: n, instruments: [], active: true })).id);
  artistId = (await db.create(ctx, "artists", {
    slug: "nora-quill-band", name: "Nora Quill Band", driveFolderId: "", links: { website: "https://band.example" },
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

test("dedupe: venue, promoter, festival and contact creates merge instead of duplicating", async () => {
  const a = await cmd("venues.create", venue("Pine Hollow Lounge"));
  const b = await cmd("venues.create", venue("pine hollow lounge", "Denver", { capacity: 300 }));
  assert.equal(b.merged, true);
  assert.equal(b.id, a.id);
  assert.equal((await db.get("venues", a.id))!.capacity, 300);
  assert.equal((await db.list("venues")).length, 1);
  assert.notEqual((await cmd("venues.create", venue("Pine Hollow Lounge", "Boulder"))).id, a.id);

  const p1 = await cmd("promoters.create", { name: "Front Range Presents", kind: "promoter" });
  assert.equal((await cmd("promoters.create", { name: "Front-Range Presents", kind: "promoter", website: "https://x.example" })).id, p1.id);
  const f1 = await cmd("festivals.create", { name: "RMF", type: "festival", address: { city: "Denver", state: "CO" } });
  assert.equal((await cmd("festivals.create", { name: "rmf", type: "festival", address: { city: "Denver", state: "CO" } })).merged, true);
  assert.ok(f1.id);
  const c1 = await cmd("contacts.create", { name: "Rosa", emails: ["Rosa@x.com"] });
  const c2 = await cmd("contacts.create", { name: "Rosa J", emails: ["rosa@x.com"], phones: ["+13035550101"] });
  assert.equal(c2.id, c1.id);
  assert.deepEqual((await db.get("contacts", c1.id))!.phones, ["+13035550101"]);
  const hist = await db.listGroup("history", (q) => q.where("entity.id", "==", c1.id));
  assert.ok(hist.some((h) => h.op === "merge"));
});

test("contacts attach to places, detach, and archive unlinks (a venue's links are the band's private notes)", async () => {
  const v = await cmd("venues.create", venue("Pine Hollow"));
  const c = await cmd("contacts.create", { name: "Rosa", emails: ["h@x.com"], attachTo: { kind: "venues", id: v.id } });
  const noteId = `${TEST_ARTIST}__${v.id}`;
  assert.deepEqual((await db.get("venueNotes", noteId))!.contactIds, [c.id]);
  assert.equal((await db.get("venues", v.id))!.contactIds, undefined, "nothing private on the shared venue");
  await cmd("contacts.detach", { contactId: c.id, kind: "venues", id: v.id });
  assert.deepEqual((await db.get("venueNotes", noteId))!.contactIds, []);
  await cmd("contacts.attach", { contactId: c.id, kind: "venues", id: v.id });
  await cmd("contacts.remove", { id: c.id });
  assert.deepEqual((await db.get("venueNotes", noteId))!.contactIds, []);
});

test("contacts.setRoles: booking and day-of per venue contact, linked if needed, dropped on detach, archive and merge keeps both sides", async () => {
  const v = await cmd("venues.create", venue("Pine Hollow"));
  const a = await cmd("contacts.create", { name: "Rosa", emails: ["h@x.com"], attachTo: { kind: "venues", id: v.id } });
  const b = await cmd("contacts.create", { name: "Sam", emails: [] });
  const note = async (id = v.id) => (await db.get("venueNotes", `${TEST_ARTIST}__${id}`))!;
  await cmd("contacts.setRoles", { contactId: a.id, venueId: v.id, roles: ["booking", "dayOf"] });
  await cmd("contacts.setRoles", { contactId: b.id, venueId: v.id, roles: ["dayOf"] });
  let n = await note();
  assert.deepEqual([n.contactIds, n.bookingContactIds, n.dayOfContactIds], [[a.id, b.id], [a.id], [a.id, b.id]], "Sam was linked by giving a role");
  await cmd("contacts.setRoles", { contactId: a.id, venueId: v.id, roles: ["booking"] });
  assert.deepEqual((await note()).dayOfContactIds, [b.id]);
  await cmd("contacts.detach", { contactId: b.id, kind: "venues", id: v.id });
  assert.equal((await note()).dayOfContactIds, undefined, "an empty role list is left off");
  await cmd("contacts.setRoles", { contactId: b.id, venueId: v.id, roles: ["dayOf"] });
  // merge: roles on both rooms are joined
  const dup = await cmd("venues.create", venue("Pine Hollow Lounge"));
  await cmd("contacts.setRoles", { contactId: a.id, venueId: dup.id, roles: ["dayOf"] });
  await cmd("venues.mergeInto", { from: dup.id, into: v.id });
  n = await note();
  assert.deepEqual([n.bookingContactIds, n.dayOfContactIds], [[a.id], [b.id, a.id]]);
  await cmd("contacts.remove", { id: a.id });
  n = await note();
  assert.deepEqual([n.contactIds, n.bookingContactIds ?? [], n.dayOfContactIds], [[b.id], [], [b.id]]);
  assert.equal("bookingContactIds" in (await db.get("venues", v.id))!, false, "roles stay off the shared venue");
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
  assert.deepEqual((await db.get("promoterNotes", `${TEST_ARTIST}__${p.id}`))!.contactIds, [c.id], "the contact link is this band's note, and the patch left it alone");
});

// ---------- venues: shared directory + private per-band notes ----------

const OTHER = "other-band";
const asOther = (): Ctx => ({ ...ctx, artistId: OTHER, runId: newRunId() });
const asMember = (): Ctx => ({ uid: "member-uid", role: "member", via: "app", runId: newRunId(), artistId: TEST_ARTIST });
const noteDoc = (artist: string, venueId: string) => db.get("venueNotes", `${artist}__${venueId}`);
const run_ = (name: string, input: unknown, c: Ctx) => cmd(name, input, c);

test("venues.create splits one input across the shared room and the band's private notes", async () => {
  const p = await cmd("promoters.create", { name: "Promo", kind: "promoter" });
  const c = await cmd("contacts.create", { name: "Rosa", emails: ["h@x.com"] });
  const r = await cmd("venues.create", venue("Deep End", "Denver", { capacity: 250, loadInNotes: "Alley door", notes: "Ask for Sam", contactIds: [c.id], promoterIds: [p.id] }));
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
  const keep = await cmd("venues.create", venue("Deep End", "Denver", { capacity: 250, notes: "keep notes", contactIds: [c1.id] }));
  const dup = await cmd("venues.create", venue("The Deep End", "Denver", { capacity: 999, website: "https://deepend.example", notes: "dup notes", contactIds: [c2.id], loadInNotes: "back door", promoterIds: [promo.id] }));
  await run_("venues.update", { id: dup.id, patch: { notes: "other band's secret", contactIds: [c1.id] } }, asOther());
  const pitch = await cmd("pitches.flag", { kind: "venue", id: dup.id });
  const show = await db.create(ctx, "shows", {
    date: "2027-01-01", status: "confirmed", venue: { id: dup.id, name: "The Deep End", address: "Denver", city: "Denver" }, times: {}, artistId: TEST_ARTIST, personnel: [],
    sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, docs: [],
  });
  const m = asOther(); // a different band's admin merges: allowed, and it moves everyone's records
  const res = await run_("venues.mergeInto", { from: dup.id, into: keep.id }, m);
  assert.equal(JSON.stringify(res).includes("secret"), false, "no band's private content comes back");
  assert.equal(res.moved.shows, 1); assert.equal(res.moved.pitches, 1);
  // references moved
  assert.deepEqual((await db.get("shows", show.id))!.venue, { id: keep.id, name: "Deep End", address: "Denver", city: "Denver" });
  assert.deepEqual([(await db.get("pitches", pitch.id))!.target.id, (await db.get("pitches", pitch.id))!.target.name], [keep.id, "Deep End"]);
  assert.deepEqual((await db.get("promoterNotes", `${TEST_ARTIST}__${promo.id}`))!.venueIds, [keep.id]);
  // each band's notes joined onto its notes for the survivor; the other band's stay its own
  const mine = (await noteDoc(TEST_ARTIST, keep.id))!, theirs = (await noteDoc(OTHER, keep.id))!;
  assert.equal(mine.notes, "keep notes\n\ndup notes"); assert.equal(mine.loadInNotes, "back door");
  assert.deepEqual(mine.contactIds.sort(), [c1.id, c2.id].sort()); assert.deepEqual(mine.promoterIds, [promo.id]);
  assert.equal(theirs.notes, "other band's secret"); assert.deepEqual(theirs.contactIds, [c1.id]);
  assert.ok((await noteDoc(TEST_ARTIST, dup.id))!.deletedAt && (await noteDoc(OTHER, dup.id))!.deletedAt, "the duplicate's notes are archived");
  // survivor: existing wins, empty fields filled; the duplicate points at it and is archived
  const k = (await db.get("venues", keep.id))!;
  assert.deepEqual([k.capacity, k.website], [250, "https://deepend.example"]);
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

test("renames keep denormalized names in sync (venue -> pitch, festival -> edition -> pitch)", async () => {
  const v = await cmd("venues.create", venue("Pine Hollow"));
  const pv = await cmd("pitches.flag", { kind: "venue", id: v.id });
  const f = await cmd("festivals.create", { name: "RMF", type: "festival", address: { city: "Denver", state: "CO" } });
  const e = await cmd("editions.create", { festivalId: f.id, year: 2027, label: "2027" });
  assert.equal((await db.get("editions", e.id))!.festivalName, "RMF");
  const pe = await cmd("pitches.flag", { kind: "edition", id: e.id });
  assert.equal((await db.get("pitches", pe.id))!.target.name, "RMF 2027");
  await cmd("venues.update", { id: v.id, patch: { name: "Pine Hollow Lounge" } });
  assert.equal((await db.get("pitches", pv.id))!.target.name, "Pine Hollow Lounge");
  await cmd("festivals.update", { id: f.id, patch: { name: "Riverbend Music Fest" } });
  assert.equal((await db.get("editions", e.id))!.festivalName, "Riverbend Music Fest");
  assert.equal((await db.get("pitches", pe.id))!.target.name, "Riverbend Music Fest 2027");
  await cmd("editions.update", { id: e.id, patch: { label: "Summer 2027" } });
  assert.equal((await db.get("pitches", pe.id))!.target.name, "Riverbend Music Fest Summer 2027");
});

test("flag: adds to the Pitch List once, fills personnel from the configuration", async () => {
  const v = await cmd("venues.create", venue("Pine Hollow"));
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
  const v = await cmd("venues.create", venue("Pine Hollow"));
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
  const v = await cmd("venues.create", venue("Pine Hollow"));
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
  const v = await cmd("venues.create", venue("Pine Hollow"));
  const { id } = await cmd("pitches.flag", { kind: "venue", id: v.id });
  await assert.rejects(cmd("pitches.sendEmail", { id, to: ["h@pinehollow.example"], subject: "Hi {{contact.firstName}}", body: "x" }), /Fill in/);
  assert.equal((await gmailClient().listMessages()).length, 0);
  const sent = await cmd("pitches.sendEmail", { id, to: ["h@pinehollow.example"], subject: "Support slot", body: "Hi Rosa", markPitched: true });
  const msgs = await gmailClient().listMessages({ account: "rudy@example.com" });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].subject, "Support slot");
  assert.deepEqual(msgs[0].to, ["h@pinehollow.example"]);
  const p = (await db.get("pitches", id))!;
  assert.ok(p.lastContactAt);
  assert.equal(p.status, "pitched");
  const act = (await db.list(`pitches/${id}/activity`)).find((a) => a.type === "emailSent")!;
  assert.equal(act.gmail.threadId, sent.threadId);
  assert.equal(act.gmail.subject, "Support slot");

  assert.equal((await cmd("pitches.checkReplies", { id })).added, 0);
  await gmailClient().simulateReply!(sent.threadId, { from: "h@pinehollow.example", body: "Sounds great, send dates." });
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

test("pitch dates: plain date strings; flag and update accept a list, stored sorted and unique; bad dates and the old object shape rejected", async () => {
  const v = await cmd("venues.create", venue("Pine Hollow"));
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

test("promoter, festival, edition and contact notes are the writing band's own: records.get gives another band the shared record and none of them (a contact is not found)", async () => {
  const p = await cmd("promoters.create", { name: "Front Range Presents", kind: "promoter" });
  const f = await cmd("festivals.create", { name: "RMF", type: "festival", address: { city: "Denver", state: "CO" } });
  const e = await cmd("editions.create", { festivalId: f.id, year: 2027, label: "2027" });
  const c = await cmd("contacts.create", { name: "Desmond Webb", emails: ["m@x.com"] });
  await cmd("promoters.update", { id: p.id, patch: { notes: "ours: email Desmond", howToPitch: "ours: video and two dates" } });
  await cmd("festivals.update", { id: f.id, patch: { notes: "ours: apply with the trio video" } });
  await cmd("editions.update", { id: e.id, patch: { notes: "ours: edition notes", payNotes: "ours: $400" } });
  await cmd("contacts.update", { id: c.id, patch: { notes: "ours: prefers texts" } });
  await run_("promoters.update", { id: p.id, patch: { howToPitch: "theirs: phone first" } }, asOther());

  const get = (kind: string, id: string, c2: Ctx = ctx) => run_("records.get", { kind, id }, c2);
  const mine = await get("promoters", p.id), theirs = await get("promoters", p.id, asOther());
  assert.deepEqual([mine.notes, mine.howToPitch], ["ours: email Desmond", "ours: video and two dates"]);
  assert.deepEqual([theirs.name, theirs.notes, theirs.howToPitch], ["Front Range Presents", undefined, "theirs: phone first"]);
  assert.equal((await get("festivals", f.id)).notes, "ours: apply with the trio video");
  assert.equal((await get("festivals", f.id, asOther())).notes, undefined);
  const ed = await get("editions", e.id), edOther = await get("editions", e.id, asOther());
  assert.deepEqual([ed.notes, ed.payNotes], ["ours: edition notes", "ours: $400"]);
  assert.deepEqual([edOther.notes, edOther.payNotes], [undefined, undefined]);
  assert.equal((await get("contacts", c.id)).notes, "ours: prefers texts");
  await assert.rejects(get("contacts", c.id, asOther()), { code: "not_found" }); // a contact belongs to one band: another band can't read it at all
  assert.equal(JSON.stringify([theirs, edOther]).includes("ours:"), false, "nothing of ours reaches the other band");
});
