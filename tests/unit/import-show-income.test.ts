/**
 * Acceptance tests for the Accounting Form import's rating step: Notes, Audience Count and the Ingie Award reach
 * the deal's rating now that the stars are optional, notes a show already has are never overwritten, and a second
 * run changes nothing. The money columns become income docs (received, on the show's project, sourceKey acct:...) and replace
 * the booked guarantee doc; the set-length columns are covered by the import's own report, not here.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { ShowDeal } from "@/schema/shows";
import { importShowIncome } from "../../scripts/import-show-income";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx;
let venueId: string;
let pitchId: string;
let bandId: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.GMAIL_BASE_URL = s.running["fake-gmail"].url;
  process.env.CALENDAR_BASE_URL = s.running["fake-calendar"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};

beforeEach(async () => {
  await resetEmulators();
  const u = await makeUser("jeff@example.com", "admin", { name: "Jeff Smith" });
  ctx = { uid: u.uid, role: "admin", via: "app", runId: newRunId() };
  await db.create(importCtx(), "artists", {
    slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: {},
    configurations: [{ id: "trio", name: "Trio", billingName: "Ingrid Avison Trio", musicianIds: [] }],
  }, { id: TEST_ARTIST });
  bandId = (await db.create(importCtx(), "projects", { artistId: TEST_ARTIST, kind: "band", name: "Band", status: "open", isDefault: true })).id;
  venueId = (await cmd("venues.create", venue("Hi-Dive"))).id;
  pitchId = (await cmd("pitches.flag", { kind: "venue", id: venueId, pitchedAs: "trio" })).id;
});

/** One Shows-tab row per show: only the columns the rating step reads, plus the money the import needs to see. */
const snapshot = (rows: { date: string; gig: string; notes?: string; audience?: string; award?: string; guarantee?: string }[]) => ({
  source: "test",
  values: [
    ["Date", "Gig", "Guarantee (Check / Venmo)", "Total Income", "Gig Length (minutes)", "Notes", "Audience Count", "Ingie Award Nomination"],
    ...rows.map((r) => [r.date, r.gig, r.guarantee ?? "$100.00", r.guarantee ?? "$100.00", "", r.notes ?? "", r.audience ?? "", r.award ?? ""]),
  ],
});

const makeShow = (date: string) =>
  cmd("shows.create", { pitchId, date, venueId, times: { loadIn: "18:00", set: "20:00" }, needs: { poster: false, backline: false, merch: false } });

const ratingOf = async (id: string) => (await db.get("showDeals", id))!.rating;
const crowdOf = async (id: string) => (await db.get("showDeals", id))!.crowd;

test("the schema allows a rating with no stars, so the import no longer holds the columns back", () => {
  assert.equal(ShowDeal.shape.rating.safeParse({ notes: "x" }).success, true);
});

test("import: notes, crowd and the Ingie Award reach the rating with no stars", async () => {
  const show = await makeShow("2026-06-28");
  const r = await importShowIncome({
    artist: "ingrid-avison-band",
    snapshot: snapshot([{ date: "6/28/2026", gig: "Hi-Dive", notes: "Great room, bad monitors", audience: "60", award: "Burrito Award" }]),
  });
  assert.equal(r.ratingsSupported, true);
  assert.equal(r.rows[0].match, "name");
  assert.equal(r.rows[0].rating, "written");
  assert.deepEqual(await ratingOf(show.id), { notes: "Great room, bad monitors\n\nIngie Award: Burrito Award" });
  assert.equal(await crowdOf(show.id), 60);
});

test("import: a second run changes nothing", async () => {
  const show = await makeShow("2026-06-28");
  const snap = snapshot([{ date: "6/28/2026", gig: "Hi-Dive", notes: "Great room", audience: "60" }]);
  await importShowIncome({ artist: "ingrid-avison-band", snapshot: snap });
  const first = await ratingOf(show.id);
  const again = await importShowIncome({ artist: "ingrid-avison-band", snapshot: snap });
  assert.equal(again.rows[0].rating, "none");
  assert.deepEqual(await ratingOf(show.id), first);
  assert.equal(await crowdOf(show.id), 60);
});

test("import: notes and a crowd the show already has are kept, and the clash is reported", async () => {
  const show = await makeShow("2026-06-28");
  await cmd("shows.afterShow", { id: show.id, show: 4, venue: 5, crowd: 80, notes: "Mine, typed in the app" });
  const r = await importShowIncome({
    artist: "ingrid-avison-band",
    snapshot: snapshot([{ date: "6/28/2026", gig: "Hi-Dive", notes: "From the sheet", audience: "60" }]),
  });
  assert.equal(r.rows[0].rating, "none");
  assert.deepEqual(await ratingOf(show.id), { show: 4, venue: 5, notes: "Mine, typed in the app" });
  assert.equal(await crowdOf(show.id), 80);
  assert.match(r.rows[0].issues.join("; "), /already has rating notes/);
});

test("import: stars already on a show survive the sheet's notes and crowd", async () => {
  const show = await makeShow("2026-06-28");
  await cmd("shows.afterShow", { id: show.id, show: 3, venue: 2 });
  const r = await importShowIncome({
    artist: "ingrid-avison-band",
    snapshot: snapshot([{ date: "6/28/2026", gig: "Hi-Dive", notes: "From the sheet", audience: "45" }]),
  });
  assert.equal(r.rows[0].rating, "written");
  assert.deepEqual(await ratingOf(show.id), { show: 3, venue: 2, notes: "From the sheet" });
  assert.equal(await crowdOf(show.id), 45);
});

test("import: a dry run reports the rating as written but writes nothing", async () => {
  const show = await makeShow("2026-06-28");
  const r = await importShowIncome({
    artist: "ingrid-avison-band", dryRun: true,
    snapshot: snapshot([{ date: "6/28/2026", gig: "Hi-Dive", notes: "Great room", audience: "60" }]),
  });
  assert.equal(r.rows[0].rating, "written");
  assert.equal(await ratingOf(show.id), undefined);
  assert.equal(await crowdOf(show.id), undefined);
});

const incomeOf = async (showId: string) => (await db.list("income", (q) => q.where("showId", "==", showId)));
const addIncome = (showId: string, body: Record<string, unknown>) =>
  db.create(importCtx(), "income", { artistId: TEST_ARTIST, date: "2026-06-28", from: "Hi-Dive", projectId: bandId, showId, ...body });

test("import: the money columns become received income docs on the default project, and a second run changes nothing", async () => {
  const show = await makeShow("2026-06-28");
  const snap = snapshot([{ date: "6/28/2026", gig: "Hi-Dive", guarantee: "$355.00" }]);
  const r = await importShowIncome({ artist: "ingrid-avison-band", snapshot: snap });
  assert.equal(r.rows[0].incomeAction, "added");
  const docs = await incomeOf(show.id);
  assert.equal(docs.length, 1);
  assert.deepEqual(
    [docs[0].sourceKey, docs[0].amount, docs[0].category, docs[0].receivedAt, docs[0].date, docs[0].from, docs[0].projectId, docs[0].artistId],
    [`acct:${show.id}:guarantee`, 35500, "guarantee", "2026-06-28", "2026-06-28", "Hi-Dive", bandId, TEST_ARTIST],
  );
  const again = await importShowIncome({ artist: "ingrid-avison-band", snapshot: snap });
  assert.equal(again.rows[0].incomeAction, "unchanged");
  assert.equal((await incomeOf(show.id)).length, 1, "a rerun never doubles the docs");
  // a changed amount in the sheet replaces the doc's amount in place
  const fixed = await importShowIncome({ artist: "ingrid-avison-band", snapshot: snapshot([{ date: "6/28/2026", gig: "Hi-Dive", guarantee: "$400.00" }]) });
  assert.equal(fixed.rows[0].incomeAction, "replaced");
  const after = await incomeOf(show.id);
  assert.deepEqual([after.length, after[0].amount, after[0].id], [1, 40000, docs[0].id]);
});

test("import: a dry run reports the income as added but writes no docs", async () => {
  const show = await makeShow("2026-06-28");
  const r = await importShowIncome({ artist: "ingrid-avison-band", dryRun: true, snapshot: snapshot([{ date: "6/28/2026", gig: "Hi-Dive", guarantee: "$355.00" }]) });
  assert.equal(r.rows[0].incomeAction, "added");
  assert.equal((await incomeOf(show.id)).length, 0);
});

test("import: a booked guarantee marked received (booking does that for past shows) is replaced, and the difference reported", async () => {
  const show = await makeShow("2026-06-28");
  await addIncome(show.id, { amount: 30000, category: "guarantee", receivedAt: "2026-06-28", sourceKey: `${show.id}:g` });
  const r = await importShowIncome({
    artist: "ingrid-avison-band",
    snapshot: snapshot([{ date: "6/28/2026", gig: "Hi-Dive", guarantee: "$355.00" }]),
  });
  assert.equal(r.rows[0].incomeAction, "replaced");
  const income = await incomeOf(show.id);
  assert.equal(income.length, 1);
  assert.equal(income[0].sourceKey, `acct:${show.id}:guarantee`);
  assert.equal(income[0].amount, 35500);
  assert.equal(income[0].receivedAt, "2026-06-28");
  assert.match(r.rows[0].issues.join("; "), /booked guarantee was \$300\.00, the sheet says \$355\.00 came in/);
});

test("import: a hand-entered income doc is still a conflict and the show's income is untouched", async () => {
  const show = await makeShow("2026-06-28");
  await addIncome(show.id, { amount: 30000, category: "guarantee", receivedAt: "2026-06-28" });
  const r = await importShowIncome({
    artist: "ingrid-avison-band",
    snapshot: snapshot([{ date: "6/28/2026", gig: "Hi-Dive", guarantee: "$355.00" }]),
  });
  assert.equal(r.rows[0].incomeAction, "conflict");
  const income = await incomeOf(show.id);
  assert.deepEqual(income.map((d) => d.amount), [30000]);
});

test("import: deal income lines the migration has not copied yet are a conflict, and nothing is written", async () => {
  const show = await makeShow("2026-06-28");
  await db.update(importCtx(), "showDeals", show.id, { income: [{ id: "hand1", category: "guarantee", amount: 30000, received: true }] });
  const r = await importShowIncome({
    artist: "ingrid-avison-band",
    snapshot: snapshot([{ date: "6/28/2026", gig: "Hi-Dive", guarantee: "$355.00" }]),
  });
  assert.equal(r.rows[0].incomeAction, "conflict");
  assert.match(r.rows[0].issues.join("; "), /migrate:money first/);
  assert.equal((await incomeOf(show.id)).length, 0);
});
