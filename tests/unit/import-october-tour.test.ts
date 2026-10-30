import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { importOctoberTour, planOctoberTour, type PlanItem } from "../../scripts/import-october-tour";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";

const HEADER = ["lodging", "Day", "", "Venue", "Location", "Time", "Event", "Who", "Set", "Sound", "Contact", "Info", "Pay", "Estimate", "note"];
const row = (lodging: string, date: string, venue = "", town = "", estimate = ""): string[] => [lodging, "", date, venue, town, "", "", "", "", "", "", "", "", estimate];
const values = (): string[][] => [
  HEADER,
  row("provided", "10/9", "Fake Barn", "Faketown", "$1,000.00"),
  row("Pat's place", "10/10", "Test Taproom", "Elsewhere", "$200"),
  row("Sam to contact a friend", "10/11", "Nowhere Hall", "Elsewhere"),
  row("", "10/11", "pending", ""),
  row("Some Inn - paying", "10/12", "Alias Text", "Mockton", "150"),
  row("some inn", "10/13", "Travel/Rest/Work Day", ""),
  row("Some Inn", "10/14", "Day Trip Cafe", "Sidetown", "75"),
  row("TBD", "10/15", "CO TOUR", "Boulder"),
  ["", "", "HOLD"],
  ["", "", "", "", "", "", "", "", "", "", "", "", "", "$1,425.00"],
];
const plan = () => planOctoberTour(values(), { "Alias Text": "alias-id" });
const brief = (i: PlanItem) =>
  i.kind === "drive" ? `${i.date} drive ${i.from}>${i.to}${i.roundTrip ? " rt" : ""}`
  : i.kind === "show" ? `${i.date} show ${i.showId} ${i.estimateCents}`
  : i.kind === "stay" ? `${i.date} stay ${i.host ? "host" : i.name} x${i.nights}${i.paying ? " paying" : ""} @${i.town}`
  : `${i.date} note/${i.why} ${i.text}${i.showId ? ` ${i.showId}` : ""}`;

test("every row kind becomes the right items, in plan order", () => {
  assert.deepEqual(plan().items.map(brief), [
    "2025-10-09 drive Boulder>Faketown",
    "2025-10-09 show vb-fake-barn-2025-10-09 100000",
    "2025-10-09 stay host x1 @Faketown",
    "2025-10-10 drive Faketown>Elsewhere",
    "2025-10-10 show vb-test-taproom-2025-10-10 20000",
    "2025-10-10 stay Pat's place x1 @Elsewhere",
    "2025-10-11 note/canceled Nowhere Hall (Elsewhere) fell through vb-nowhere-hall-2025-10-11",
    "2025-10-11 note/lead Lodging: Sam to contact a friend",
    "2025-10-12 drive Elsewhere>Mockton",
    "2025-10-12 show vb-alias-id-2025-10-12 15000",
    "2025-10-12 stay Some Inn x3 paying @Mockton",
    "2025-10-13 note/travel Travel / rest / work day",
    "2025-10-14 drive Mockton>Sidetown rt",
    "2025-10-14 show vb-day-trip-cafe-2025-10-14 7500",
    "2025-10-15 drive Mockton>Boulder",
  ]);
});

test("dates, estimate and skipped rows", () => {
  const p = plan();
  assert.equal(p.name, "October 2025 Colorado Tour");
  assert.equal(p.startDate, "2025-10-09");
  assert.equal(p.endDate, "2025-10-15");
  assert.equal(p.leavingFrom, "Boulder");
  assert.equal(p.estimateCents, 142500, "the fell-through row and the legend's total are not counted");
  assert.deepEqual(p.skipped, [{ row: 5, date: "2025-10-11", why: "pending: no venue" }]);
});

test("a multi-night stay takes its town from the first located row, so a day trip is a round trip", () => {
  const stay = plan().items.find((i) => i.kind === "stay" && i.name === "Some Inn");
  assert.equal(stay?.kind === "stay" && stay.town, "Mockton");
  assert.equal(plan().items.filter((i) => i.kind === "stay").length, 3, "the second and third nights are not stays of their own");
});

// ---------- importOctoberTour against the emulator ----------

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx;
let duo: string;
const ALIASES = { "Alias Text": "alias-id" };
const TOUR = "october-2025-co-tour";
const entriesOf = async () => await db.list(`tours/${TOUR}/entries`);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  for (const [name, env] of [["fake-ors", "ORS_BASE_URL"], ["fake-drive", "DRIVE_BASE_URL"], ["fake-bandsintown", "BANDSINTOWN_BASE_URL"], ["fake-calendar", "CALENDAR_BASE_URL"]] as const) {
    if (s.running[name]) process.env[env] = s.running[name].url;
  }
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

beforeEach(async () => {
  await resetEmulators();
  const a = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST, now: new Date("2025-11-06T18:00:00Z") };
  await db.create(ctx, "artists", { slug: "band", name: "Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
  const r = registry["projects.create"];
  await r.run(ctx, r.input.parse({ kind: "band", name: "Band", isDefault: true }));
  duo = ((await r.run(ctx, r.input.parse({ kind: "duo", name: "Duo" }))) as { id: string }).id;
  const show = (id: string, date: string, venue: string, extra: Record<string, unknown> = {}) =>
    db.create(ctx, "shows", { artistId: TEST_ARTIST, date, venue: { id: `v-${id}`, name: venue }, times: {}, sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, docs: [], listings: {}, status: "confirmed", projectId: duo, billedAs: "duo", personnel: ["m1", "m2"], ...extra }, { id });
  await show("vb-fake-barn-2025-10-09", "2025-10-09", "Fake Barn", { hostName: "Pat Host" });
  await show("vb-test-taproom-2025-10-10", "2025-10-10", "Test Taproom");
  await show("vb-nowhere-hall-2025-10-11", "2025-10-11", "Nowhere Hall", { status: "canceled" });
  await show("vb-alias-id-2025-10-12", "2025-10-12", "Alias Text");
  await show("vb-day-trip-cafe-2025-10-14", "2025-10-14", "Day Trip Cafe");
  const inc = (id: string, showId: string, amount: number) => db.create(ctx, "income", { artistId: TEST_ARTIST, amount, category: "guarantee", from: "Door", showId, date: "2025-10-09", projectId: duo }, { id });
  await inc("inc-barn", "vb-fake-barn-2025-10-09", 100000);
  await inc("inc-taproom", "vb-test-taproom-2025-10-10", 20000);
});

test("a dry run reports the plan and writes nothing", async () => {
  const r = await importOctoberTour({ dryRun: true, values: values(), aliases: ALIASES });
  assert.ok(r.rows.some((x) => x.collection === "tours" && x.action === "created"));
  assert.ok(r.rows.some((x) => x.collection === "tour entries" && x.action === "created"));
  assert.equal(await db.get("tours", TOUR), null);
  assert.equal((await entriesOf()).length, 0);
  assert.ok((await db.list("shows")).every((s) => !s.tourId));
  assert.ok((await db.list("income")).every((i) => !i.tourId));
});

test("a real run builds the tour, tags shows and income, and a rerun changes nothing", async () => {
  const r = await importOctoberTour({ dryRun: false, values: values(), aliases: ALIASES });
  const tour = (await db.get("tours", TOUR))!;
  assert.deepEqual([tour.status, tour.projectId, tour.billedAs, tour.startDate, tour.endDate], ["done", duo, "duo", "2025-10-09", "2025-10-15"]);
  assert.deepEqual(tour.personnel, ["m1", "m2"]);
  assert.equal(r.incomeCents, 120000);

  const entries = await entriesOf();
  const of = (kind: string) => entries.filter((e) => e.kind === kind);
  const shows = of("show");
  assert.deepEqual(shows.map((e) => e.showId).sort(), ["vb-alias-id-2025-10-12", "vb-day-trip-cafe-2025-10-14", "vb-fake-barn-2025-10-09", "vb-test-taproom-2025-10-10"]);

  const drives = of("drive");
  assert.equal(drives.length, 5);
  assert.ok(drives.every((d) => typeof d.miles === "number" && typeof d.minutes === "number"), "miles and minutes from the fake ORS");
  assert.ok(drives.some((d) => d.roundTrip && d.date === "2025-10-14"));

  const stays = of("stay");
  assert.ok(stays.some((e) => e.name === "Pat Host" && e.date === "2025-10-09"), "the host stay is named after the show's hostName");
  assert.ok(stays.some((e) => e.name === "Some Inn" && e.nights === 3));
  assert.ok(stays.some((e) => e.name === "Pat's place"));

  const notes = of("note").map((e) => e.text);
  assert.ok(notes.includes("Travel / rest / work day"));
  assert.ok(notes.includes("Nowhere Hall (Elsewhere) fell through"));
  assert.ok(notes.includes("Lodging: Sam to contact a friend"));

  for (const e of shows) assert.equal((await db.get("shows", e.showId))!.tourId, TOUR);
  assert.equal((await db.get("shows", "vb-nowhere-hall-2025-10-11"))!.tourId ?? null, null);
  const entryOf = (showId: string) => shows.find((e) => e.showId === showId)!.id;
  for (const [id, showId] of [["inc-barn", "vb-fake-barn-2025-10-09"], ["inc-taproom", "vb-test-taproom-2025-10-10"]]) {
    const i = (await db.get("income", id))!;
    assert.deepEqual([i.tourId, i.tourEntryId], [TOUR, entryOf(showId)]);
  }

  const again = await importOctoberTour({ dryRun: false, values: values(), aliases: ALIASES });
  assert.ok(again.rows.length > 0);
  assert.ok(again.rows.every((x) => x.action === "unchanged"), JSON.stringify(again.rows.filter((x) => x.action !== "unchanged")));
  assert.equal((await entriesOf()).length, entries.length);
});
