/** The Sheet tab (#52): the rows (admin and band), the CSV, and tours.sheet's one linked Google Sheet in the fake Drive. */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { BAND_FOLDER_ID } from "../../fakes/fake-drive/server";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { isEligible } from "@/server/assistant/policy";
import { sheetCsv, tourSheet, type SheetEntry, type SheetPitch, type SheetShow } from "@/lib/tourSheet";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

// ---------- pure ----------

const e = (id: string, kind: SheetEntry["kind"], date: string | undefined, position: number, more: Partial<SheetEntry> = {}): SheetEntry => ({ id, kind, date, position, visibility: kind === "option" ? "admins" : "band", ...more });
const tour = { startDate: "2027-03-09", endDate: "2027-03-12" };
const FC = { name: "Fort Collins", address: "Fort Collins, CO, USA" }, BOULDER = { name: "Boulder", address: "Boulder, CO, USA" };
const entries: SheetEntry[] = [
  e("d1", "drive", "2027-03-09", 1, { from: BOULDER, to: FC, minutes: 65, miles: 64, leaveBy: "15:20" }),
  e("sh", "show", "2027-03-09", 2, { showId: "s1" }),
  e("st", "stay", "2027-03-09", 3, { name: "Airbnb", address: FC, nights: 2, checkIn: "15:00" }),
  e("n", "note", "2027-03-10", 1, { text: "=Day off, no formula" }),
  e("o1", "option", "2027-03-11", 1, { pitchId: "p1" }),
  e("o2", "option", "2027-03-11", 2, { pitchId: "p2" }),
  e("b", "option", undefined, 1, { pitchId: "p3" }),
  e("home", "drive", "2027-03-12", 1, { from: FC, to: BOULDER }),
];
const shows = new Map<string, SheetShow>([["s1", {
  venue: { id: "v1", name: "Washington's", city: "Fort Collins" }, times: { loadIn: "17:00", doors: "19:00", set: "20:30", setLengthSec: 5400 },
  sound: { provider: "venueProvided", notes: "Two wedges" }, dayOfContact: { name: "Sam", phone: "970-555-0100" },
}]]);
const pitches = new Map<string, SheetPitch>([["p1", { target: { name: "Velour" }, dates: ["2027-03-11", "2027-03-12"] }], ["p2", { target: { name: "Muse Music" } }], ["p3", { target: { name: "The State Room" } }]]);

test("one row per day: the drive, the show with times, set, sound and contact, a stay on every night it covers, notes", () => {
  const { rows, bucket } = tourSheet(tour, entries, shows, pitches, { band: false });
  assert.deepEqual(rows.map((r) => [r.date, r.n, r.of, r.town]), [["2027-03-09", 1, 4, "Fort Collins"], ["2027-03-10", 2, 4, "Fort Collins"], ["2027-03-11", 3, 4, "Fort Collins"], ["2027-03-12", 4, 4, "Boulder"]]);
  const [d1, d2, d3, d4] = rows;
  assert.deepEqual(d1.drive, [{ text: "Boulder → Fort Collins", sub: "1 h 5 min · 64 mi · leave by 3:20 pm", link: { kind: "entry", id: "d1" } }]);
  assert.deepEqual(d1.show, [{ text: "Washington's", sub: "Fort Collins", link: { kind: "show", id: "s1" } }]);
  assert.deepEqual(d1.times, ["Load in 5:00 pm · Doors 7:00 pm · Set 8:30 pm"]);
  assert.deepEqual(d1.set, ["1h 30m"]);
  assert.deepEqual(d1.sound, [{ text: "Venue", sub: "Two wedges" }]);
  assert.deepEqual(d1.contact, [{ text: "Sam", sub: "970-555-0100" }]);
  assert.equal(d1.stay[0].sub, "Fort Collins · 2 nights · check in 3:00 pm");
  assert.equal(d2.stay[0].sub, "Fort Collins · night 2 of 2", "the second night of the Airbnb");
  assert.equal(d2.noStay, false);
  assert.deepEqual(d2.notes.map((c) => c.text), ["=Day off, no formula"]);
  assert.equal(d3.noStay, true);
  assert.equal(d3.open, true);
  assert.deepEqual(d3.options.map((o) => [o.rank, o.text, o.sub]), [[1, "Velour", "Option 1 of 2 · also Fri Mar 12"], [2, "Muse Music", "Option 2 of 2"]]);
  assert.equal(d4.noStay, false, "the last day is the drive home");
  assert.deepEqual(bucket.map((c) => c.text), ["The State Room"]);
});

test("the band version has no options, no Open and no No date yet", () => {
  const { rows, bucket } = tourSheet(tour, entries, shows, pitches, { band: true });
  assert.ok(rows.every((r) => !r.open && r.options.length === 0));
  assert.deepEqual(bucket, []);
});

test("the CSV: a header, a row per day, several things in one cell on separate lines, and formulas made text", () => {
  const csv = sheetCsv(tourSheet(tour, entries, shows, pitches, { band: false }));
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "Date,Day,Town,Drive,Show,Times,Set,Sound,Contact,Stay,Notes");
  assert.equal(lines[1], "Tue Mar 9,1 of 4,Fort Collins,Boulder → Fort Collins · 1 h 5 min · 64 mi · leave by 3:20 pm,Washington's · Fort Collins,Load in 5:00 pm · Doors 7:00 pm · Set 8:30 pm,1h 30m,Venue · Two wedges,Sam · 970-555-0100,Airbnb · Fort Collins · 2 nights · check in 3:00 pm,");
  assert.ok(lines[2].endsWith(",\"'=Day off, no formula\""), "a leading = is quoted as text");
  assert.ok(csv.includes("\"Open\nVelour · Option 1 of 2 · also Fri Mar 12\nMuse Music · Option 2 of 2\""));
  assert.ok(csv.includes("No date yet: The State Room"));
  const band = sheetCsv(tourSheet(tour, entries, shows, pitches, { band: true }));
  assert.ok(!band.includes("Velour") && !band.includes("No date yet"));
});

// ---------- tours.sheet ----------

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  for (const [name, env] of [["fake-ors", "ORS_BASE_URL"], ["fake-drive", "DRIVE_BASE_URL"], ["fake-bandsintown", "BANDSINTOWN_BASE_URL"], ["fake-calendar", "CALENDAR_BASE_URL"]] as const) {
    if (s.running[name]) process.env[env] = s.running[name].url;
  }
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const contentOf = async (id: string) => (await fetch(`${process.env.DRIVE_BASE_URL}/files/${id}/content`)).text();

beforeEach(async () => {
  await resetEmulators();
  await fetch(process.env.DRIVE_BASE_URL + "/__reset", { method: "POST" });
  const a = await makeUser("jeff@example.com", "admin", { name: "Jeff Dean" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST, now: new Date("2026-11-06T18:00:00Z") };
  await db.create(ctx, "artists", { slug: "band", name: "Band", driveFolderId: BAND_FOLDER_ID, links: {}, configurations: [] }, { id: TEST_ARTIST });
});

test("tours.sheet makes one Google Sheet in the band folder, the band version, then rewrites the same one", async () => {
  const duo = (await cmd("projects.create", { kind: "duo", name: "Duo", isDefault: true })).id;
  const velour = (await cmd("venues.create", venue("Velour", "Provo", { address: { city: "Provo", state: "UT" }, region: "out" }))).id;
  const t = (await cmd("tours.create", { name: "Mountain West", projectId: duo, startDate: "2026-11-05", endDate: "2026-11-07" })).id;
  await cmd("tours.entries.add", { tourId: t, kind: "stay", date: "2026-11-05", name: "Airbnb" });
  await cmd("tours.addPitch", { tourId: t, venueId: velour, dates: ["2026-11-06"] });

  const first = await cmd("tours.sheet", { id: t });
  assert.equal(first.made, true);
  const linked = (await db.get("tours", t))!.sheet;
  assert.equal(linked.updatedBy, "Jeff");
  assert.equal(linked.updatedAt, "2026-11-06T18:00:00.000Z");
  const file = await (await fetch(`${process.env.DRIVE_BASE_URL}/files/${linked.driveFileId}`)).json();
  assert.deepEqual([file.name, file.mimeType, file.parents], ["Mountain West", "application/vnd.google-apps.spreadsheet", [BAND_FOLDER_ID]]);
  const csv = await contentOf(linked.driveFileId);
  assert.ok(csv.startsWith("Date,Day,Town,"));
  assert.ok(csv.includes("Airbnb"));
  assert.ok(!csv.includes("Velour") && !csv.includes("Open"), "never the options");

  await cmd("tours.entries.add", { tourId: t, kind: "note", date: "2026-11-06", text: "Laundry" });
  const second = await cmd("tours.sheet", { id: t });
  assert.equal(second.made, false);
  assert.equal((await db.get("tours", t))!.sheet.driveFileId, linked.driveFileId, "the same sheet");
  assert.ok((await contentOf(linked.driveFileId)).includes("Laundry"));
  const sheets = await (await fetch(`${process.env.DRIVE_BASE_URL}/files?mimeType=application/vnd.google-apps.spreadsheet`)).json();
  assert.equal(sheets.length, 1, "a second copy never makes a second file");
});

test("tours.sheet: admins only, needs the band folder, and Roadie never gets it", async () => {
  assert.deepEqual(registry["tours.sheet"].roles, ["admin"]);
  assert.equal(isEligible("tours.sheet", "admin"), false);
  await db.update(ctx, "artists", TEST_ARTIST, { driveFolderId: "" });
  const duo = (await cmd("projects.create", { kind: "duo", name: "Duo", isDefault: true })).id;
  const t = (await cmd("tours.create", { name: "Mountain West", projectId: duo, startDate: "2026-11-05", endDate: "2026-11-06" })).id;
  await assert.rejects(cmd("tours.sheet", { id: t }), (err: any) => err.code === "no_band_folder"); // eslint-disable-line @typescript-eslint/no-explicit-any
});
