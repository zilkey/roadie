/**
 * The Venue Book sheet import: Ingrid's pitch log (column D) and miles. The fixture is one of each row the real tab has:
 * "sent" on a venue the app has, "sent" on a venue it does not, a bare date, "booked" with and without a show, "meh gig",
 * text nobody understands, a house with miles, and a venue already on the Pitch List from the support-slot import.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { importVenueBookSheet, venueBookSheetSurvey, readPitchLog } from "../../scripts/import-venue-book-sheet";
import { rowsFromValues } from "../../scripts/snapshot-venue-book";
import type { VenueBookSnapshot, VenueBookRow } from "../../scripts/snapshot-venue-book";
import { group } from "../../scripts/survey";
import { resetEmulators, makeArtist, makeUser, TEST_ARTIST, venue } from "./helpers";

beforeEach(resetEmulators);

const row = (n: number, name: string, extra: Partial<VenueBookRow> = {}): VenueBookRow => ({
  row: n, name, city: "Longmont, CO", type: "Brewery / taproom", pitchLog: "", miles: "16", status: "Lead",
  contact: "", contactEmail: "", contactPhone: "", contactNotes: "", ...extra,
});

const fixture = (): VenueBookSnapshot => ({
  source: "https://docs.google.com/spreadsheets/d/test/edit#gid=9101", fetchedAt: "2026-10-25",
  rows: [
    row(2, "Honnibrook", { pitchLog: "10/23", city: "Castle Rock, CO", miles: "58" }),
    row(3, "Wibby Brewing", { pitchLog: "sent 10/23", miles: "14.7", contactEmail: "booking@brewery.example" }),
    row(4, "Drifters Thrift Bar", { pitchLog: "booked", type: "Bar / club" }),
    row(5, "St. Vrain Cidery", { pitchLog: "booked" }),
    row(6, "Coopersmith's", { pitchLog: "meh gig", city: "Fort Collins, CO", miles: "47" }),
    row(7, "Wild Cider", { pitchLog: "sent 10/23", miles: "20" }),
    row(8, "Velvet Elk Lounge", { pitchLog: "sent 10/24", type: "Bar / club", city: "Boulder, CO", miles: "0" }),
    row(9, "Odd One", { pitchLog: "call them", miles: "" }),
    row(10, "Testhost House Show", { type: "House concert", city: "Denver, CO", miles: "28" }),
  ],
});

async function world() {
  await makeArtist("Ingrid Avison Band", "ingrid-avison-band");
  await makeUser("jeff@example.com", "admin", { name: "Jeff Dean" });
  const ctx = importCtx();
  // The venues the tracker import made, under its ids; Wibby and Odd One are not among them.
  for (const [id, name, city] of [["vb-honnibrook", "Honnibrook", "Castle Rock"], ["vb-drifters", "Drifters Thrift Bar", "Longmont"],
    ["vb-st-vrain-cidery", "St. Vrain Cidery", "Longmont"], ["vb-coopersmith-s", "Coopersmith's", "Fort Collins"], ["vb-wild-cider", "Wild Cider", "Longmont"],
    ["ss-velvet-elk", "Velvet Elk Lounge", "Boulder"]]) {
    await db.create(ctx, "venues", venue(name, city, { type: "brewery", region: "boulder" }), { id });
  }
  // Drifters has its booked show; St. Vrain does not, which the survey must say.
  await db.create(ctx, "shows", {
    date: "2027-02-26", status: "confirmed", kind: "venue", venue: { id: "vb-drifters", name: "Drifters Thrift Bar" }, artistId: TEST_ARTIST,
    personnel: [], sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, checklists: [], docs: [], listings: {}, times: {},
  }, { id: "vb-drifters-2027-02-26" });
  // Velvet Elk is already on the Pitch List from the support-slot import.
  await db.create(ctx, "pitches", {
    target: { kind: "venue", id: "ss-velvet-elk", name: "Velvet Elk Lounge" }, status: "toPitch", artistId: TEST_ARTIST, personnel: [], showIds: [],
  }, { id: "ss-velvet-elk" });
}

test("the pitch log reads the way Jeff decided", () => {
  assert.deepEqual(readPitchLog("sent 10/23", "2026-10-25"), { kind: "sent", date: "2026-10-23", bare: false });
  assert.deepEqual(readPitchLog("10/23", "2026-10-25"), { kind: "sent", date: "2026-10-23", bare: true });
  // A log entry is never in the future: a day past the capture is last year's.
  assert.deepEqual(readPitchLog("sent 11/2", "2026-10-25"), { kind: "sent", date: "2025-11-02", bare: false });
  assert.deepEqual(readPitchLog("sent 10/23/25", "2026-10-25"), { kind: "sent", date: "2025-10-23", bare: false });
  assert.deepEqual(readPitchLog("Booked", "2026-10-25"), { kind: "booked" });
  assert.deepEqual(readPitchLog("meh gig", "2026-10-25"), { kind: "note", text: "Meh gig" });
  assert.deepEqual(readPitchLog("", "2026-10-25"), { kind: "none" });
  assert.deepEqual(readPitchLog("call them", "2026-10-25"), { kind: "unknown", text: "call them" });
});

test("the snapshot finds columns by header and refuses a tab missing one", () => {
  const header = ["Venue", "Location", "Type", "E-mail", "Miles from Boulder", "Status", "Booking contact", "Email", "Phone", "Contact notes"];
  const { rows, unknownHeaders } = rowsFromValues([[...header, "Extra"], ["Honnibrook", "Castle Rock, CO", "Brewery / taproom", "10/23", 58, "Lead"], [""]]);
  assert.deepEqual(unknownHeaders, ["Extra"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].row, 2);
  assert.equal(rows[0].miles, "58");
  assert.equal(rows[0].pitchLog, "10/23");
  assert.throws(() => rowsFromValues([header.filter((h) => h !== "E-mail")]), /no "e-mail" column/);
});

test("a sent row makes one pitched pitch with the comment, and miles go on the venue's notes", async () => {
  await world();
  const r = await importVenueBookSheet({ artist: "ingrid-avison-band", snapshot: fixture() });
  const pitch = await db.get("pitches", "vbs-wild-cider");
  assert.ok(pitch);
  assert.equal(pitch.status, "pitched");
  assert.deepEqual(pitch.target, { kind: "venue", id: "vb-wild-cider", name: "Wild Cider" });
  assert.equal(pitch.lastContactAt.toDate().toISOString().slice(0, 10), "2026-10-23");
  const comments = await db.list("pitches/vbs-wild-cider/comments");
  assert.deepEqual(comments.map((c) => c.body), ["Sent message on 10/23/2026"]);
  const note = await db.get("venueNotes", `${TEST_ARTIST}__vb-wild-cider`);
  assert.equal(note?.notes, "20 miles from Boulder (Ingrid's distance calculation)");
  // The bare date made a pitch too, and the survey says it was read that way.
  assert.equal((await db.get("pitches", "vbs-honnibrook"))?.status, "pitched");
  const decide = group(r.notes, "decide");
  assert.deepEqual(decide.map((g) => [g.reason.slice(0, 9), g.rows.map((x) => x.where)]), [["bare date", ["row 2 Honnibrook"]]]);
});

test("a venue the app does not have is created with its contact; a house's miles are deferred", async () => {
  await world();
  const r = await importVenueBookSheet({ artist: "ingrid-avison-band", snapshot: fixture() });
  const wibby = await db.get("venues", "vbs-wibby-brewing");
  assert.ok(wibby);
  assert.equal(wibby.type, "brewery");
  assert.deepEqual(wibby.address, { city: "Longmont", state: "CO" });
  const contact = await db.get("contacts", "vbs-wibby-brewing-c1");
  assert.deepEqual(contact?.emails, ["booking@brewery.example"]);
  assert.deepEqual((await db.get("venueNotes", `${TEST_ARTIST}__vbs-wibby-brewing`))?.contactIds, ["vbs-wibby-brewing-c1"]);
  assert.equal((await db.get("pitches", "vbs-wibby-brewing"))?.target.id, "vbs-wibby-brewing");
  // Odd One: created too, but its log text is reported and makes nothing.
  assert.ok(await db.get("venues", "vbs-odd-one"));
  assert.equal(await db.get("pitches", "vbs-odd-one"), null);
  const unclean = group(r.notes, "unclean");
  assert.deepEqual(unclean.map((g) => [g.reason, g.rows.map((x) => x.where)]).sort(), [
    ["\"booked\" but the app has no show at this venue", ["row 5 St. Vrain Cidery"]],
    ["E-mail column text not understood, so nothing was made from it", ["row 9 Odd One"]],
    ["target is already on the Pitch List under another pitch, so no pitch was made", ["row 8 Velvet Elk Lounge"]],
  ]);
  const deferred = group(r.notes, "deferred");
  assert.ok(deferred.some((g) => g.reason.startsWith("miles not kept") && g.rows[0].where === "row 10 Testhost House Show"));
  assert.equal(await db.get("venues", "vbs-testhost-house-show"), null);
  // "meh gig" is a venue note, and "booked" with a show makes nothing.
  assert.equal((await db.get("venueNotes", `${TEST_ARTIST}__vb-coopersmith-s`))?.notes, "47 miles from Boulder (Ingrid's distance calculation)\nMeh gig");
  assert.equal(await db.get("pitches", "vbs-drifters-thrift-bar"), null);
});

test("a dry run writes nothing and reports the same as the real run; a re-run adds nothing", async () => {
  await world();
  const dry = await importVenueBookSheet({ dryRun: true, artist: "ingrid-avison-band", snapshot: fixture() });
  assert.equal(await db.get("pitches", "vbs-wild-cider"), null);
  assert.equal(await db.get("venues", "vbs-wibby-brewing"), null);
  const real = await importVenueBookSheet({ artist: "ingrid-avison-band", snapshot: fixture() });
  assert.deepEqual(venueBookSheetSurvey(dry).clean, venueBookSheetSurvey(real).clean);
  assert.deepEqual(venueBookSheetSurvey(real).totals, { "venues matched": 6, "venues created": 2, "pitches created": 3, "miles added": 7 });
  const again = await importVenueBookSheet({ artist: "ingrid-avison-band", snapshot: fixture() });
  assert.equal(again.written.filter((w) => w.action === "created").length, 0);
  assert.deepEqual(venueBookSheetSurvey(again).totals, { "venues matched": 8, "venues created": 0, "pitches created": 0, "miles added": 0 });
  assert.equal((await db.list("pitches/vbs-wild-cider/comments")).length, 1);
});
