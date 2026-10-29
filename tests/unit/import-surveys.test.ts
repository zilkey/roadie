/**
 * The surveys, and the two fixes that let the imports be pointed at a real project at all:
 *   - the booking kit's --yes guard (the other two already had one);
 *   - gas rows resolving to the right musician by email, with the name as a fallback, and an unresolvable musician
 *     failing loudly instead of skipping every row quietly;
 *   - each survey putting a known-bad row in the unclean/decide list with its reason, and a clean snapshot
 *     producing an empty one.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { importShowIncome, incomeSurvey } from "../../scripts/import-show-income";
import { importGas, gasSurvey, resolveMusician, type GasSnapshot } from "../../scripts/import-gas";
import { formatSurvey, group, tally, note, type Survey } from "../../scripts/survey";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx;
let venueId: string;
let pitchId: string;

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
  venueId = (await cmd("venues.create", venue("Hi-Dive"))).id;
  pitchId = (await cmd("pitches.flag", { kind: "venue", id: venueId, pitchedAs: "trio" })).id;
});

const makeShow = (date: string) =>
  cmd("shows.create", { pitchId, date, venueId, times: { loadIn: "18:00", set: "20:00" }, needs: { poster: false, backline: false, merch: false } });

// ---------- the survey formatter ----------

test("a survey groups many rows of one problem into one line with a count, and leads with the decisions", () => {
  const s: Survey = {
    title: "T", project: "p", dryRun: true, clean: { venues: { created: 2 } },
    notes: [
      ...Array.from({ length: 30 }, (_, i) => note("unclean", "no show that day", `line ${i + 2}`)),
      note("decide", "two shows fit equally well", "line 40"),
      note("deferred", "column not carried", "Hours"),
    ],
  };
  const out = formatSurvey(s);
  // One grouped line with the count, and the detail lines are capped rather than printing all thirty.
  assert.match(out, /no show that day -- 30/, out);
  assert.match(out, /\.\.\. and 18 more/, out);
  // Jeff's list is above the merely-unclean one.
  assert.ok(out.indexOf("Needs a decision") < out.indexOf("Won't land cleanly"), out);
  assert.match(out, /31 thing\(s\) to read before the real run\./, out);

  assert.deepEqual(group(s.notes, "decide").map((g) => g.reason), ["two shows fit equally well"]);
});

test("a survey with nothing unclean and nothing to decide says it is safe to run", () => {
  const out = formatSurvey({
    title: "T", project: "p", dryRun: true, clean: { venues: { created: 2 } },
    notes: [note("deferred", "a column this import doesn't carry", "Hours")],
  });
  assert.match(out, /Nothing unclean and nothing to decide: safe to run\./, out);
  // A deliberate deferral is still shown, so nothing looks lost later.
  assert.match(out, /Deferred on purpose \(1\)/, out);
});

test("tally counts by collection and action", () => {
  assert.deepEqual(
    tally([
      { collection: "venues", action: "created" }, { collection: "venues", action: "created" },
      { collection: "venues", action: "already there" }, { collection: "shows", action: "created" },
    ]),
    { venues: { created: 2, "already there": 1 }, shows: { created: 1 } },
  );
});

// ---------- the booking kit's --yes guard ----------

test("the booking kit refuses real Firestore without --yes, and writes nothing", async () => {
  const script = path.join(process.cwd(), "scripts/import-booking-kit.ts");
  const { FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, GOOGLE_APPLICATION_CREDENTIALS, ...bare } = process.env;
  // A made-up project id: the guard throws before any Firestore call, so nothing real is contacted -- and naming a
  // real project here is exactly what the guard exists to make hard.
  const PROJECT = "not-a-real-project-xyz";
  const r = spawnSync("npx", ["tsx", script], {
    env: { ...bare, GCLOUD_PROJECT: PROJECT } as NodeJS.ProcessEnv, encoding: "utf8", timeout: 60_000,
  });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  assert.notEqual(r.status, 0, out);
  // The same wording as the other two importers.
  assert.match(out, /This would write to REAL Firestore\./, out);
  assert.match(out, /--dry-run to look first, or --yes if that is what you want/, out);
  // Nothing reached the emulator either. The booking kit's records carry its own fixed-id prefixes, so those are
  // what to look for: beforeEach's venue and pitch are not among them.
  const mine = (rows: { id: string }[]) => rows.filter((x) => /^(vb|fr|ss)-/.test(x.id));
  for (const path of ["venues", "festivals", "editions", "contacts", "promoters", "pitches", "shows"]) {
    assert.deepEqual(mine(await db.list(path)), [], `nothing was written to ${path}`);
  }
});

// ---------- gas: who the drives belong to ----------

/** The Fuel Cost tab's columns, with one row per drive. */
const gasSnapshot = (
  rows: { date: string; type: string; place: string; miles?: string; paid?: string }[],
  who: { musician: string; musicianEmail?: string },
): GasSnapshot => ({
  source: "test", mpg: 27, ...who,
  values: [
    ["Date", "Type", "Place", "Address", "One-way mi", "Round-trip mi", "Gas $/gal", "Gallons", "Fuel cost", "Paid"],
    ...rows.map((r) => {
      const rt = r.miles ?? "54.0";
      // 54 mi / 27 mpg x $4.00 = $8.00, so the row's own arithmetic check passes.
      return [r.date, r.type, r.place, "2 Example Ave, Testville, CO 80000", String(+rt / 2), rt, "$4.00", "2.00", `$${((+rt / 27) * 4).toFixed(2)}`, r.paid ?? "FALSE"];
    }),
  ],
});

/** Nico as the real roster has him: a full name, and the email the snapshot now carries. */
const makeNico = async (name = "Nico Alvarez", email = "nico@example.com") => {
  const m = await cmd("musicians.create", { name, email, instruments: ["drums"] });
  await makeUser(email, "member", { name, musicianId: m.id });
  return m.id;
};

test("gas rows resolve to Nico Alvarez by email when the snapshot carries musicianEmail", async () => {
  const musicianId = await makeNico();
  // The snapshot says "Nico"; the roster says "Nico Alvarez". Only the email can bridge that.
  const r = await importGas({
    artist: "ingrid-avison-band",
    snapshot: gasSnapshot([{ date: "6/28/2026", type: "Rehearsal", place: "David's" }], { musician: "Nico", musicianEmail: "nico@example.com" }),
  });
  assert.equal(r.resolved?.how, "email");
  assert.equal(r.resolved?.musicianName, "Nico Alvarez");
  assert.equal(r.resolved?.musicianEmail, "nico@example.com");
  assert.equal(r.rows[0].action, "created");
  // The expense is his, and its id carries his musician record.
  assert.equal(r.rows[0].expenseId, `gas-${musicianId}-2026-06-28`);
  const expense = await db.get("expenses", r.rows[0].expenseId);
  assert.equal(expense?.userId, r.resolved?.userId);
  assert.equal(expense?.payBack, true);
});

test("gas falls back to the full-name match for a snapshot with no email", async () => {
  await makeNico();
  const r = await importGas({
    artist: "ingrid-avison-band",
    snapshot: gasSnapshot([{ date: "6/28/2026", type: "Rehearsal", place: "David's" }], { musician: "Nico Alvarez" }),
  });
  assert.equal(r.resolved?.how, "name");
  assert.equal(r.resolved?.musicianName, "Nico Alvarez");
  assert.equal(r.rows[0].action, "created");
});

test("an unresolvable musician is reported loudly, not skipped quietly", async () => {
  await makeNico();
  const snapshot = gasSnapshot(
    [{ date: "6/28/2026", type: "Rehearsal", place: "David's" }, { date: "7/26/2026", type: "Rehearsal", place: "David's" }],
    { musician: "Nobody", musicianEmail: "nobody@example.com" },
  );
  const r = await importGas({ artist: "ingrid-avison-band", snapshot });
  assert.equal(r.resolved, undefined);
  assert.deepEqual(r.rows.map((x) => x.action), ["skipped", "skipped"]);
  assert.deepEqual(await db.list("expenses"), [], "and nothing was written");

  // The survey says it once, at the top, instead of leaving it to be inferred from N identical row issues.
  const out = formatSurvey(gasSurvey(r));
  assert.match(out, /NO MUSICIAN RESOLVED/, out);
  assert.match(out, /musician: NONE RESOLVED/, out);
  assert.ok(gasSurvey(r).notes.some((n) => n.bucket === "unclean"), "it is unclean, not deferred");
});

test("resolveMusician prefers the email even when another musician's name matches", () => {
  const musicians = [
    { id: "m1", name: "Nico", email: "nico.the.other@example.com" },
    { id: "m2", name: "Nico Alvarez", email: "nico@example.com" },
  ] as any;
  // A first-name match would take the wrong Nico; the email takes the right one.
  assert.equal(resolveMusician({ musician: "Nico", musicianEmail: "nico@example.com" }, musicians).musician?.id, "m2");
  assert.equal(resolveMusician({ musician: "Nico" }, musicians).musician?.id, "m1");
});

// ---------- gas: the survey ----------

test("the gas survey puts a Paid row and a show-less drive in the right lists, and names who each row is for", async () => {
  await makeNico();
  const r = await importGas({
    artist: "ingrid-avison-band",
    snapshot: gasSnapshot([
      { date: "6/28/2026", type: "Rehearsal", place: "David's" },
      { date: "7/26/2026", type: "Rehearsal", place: "David's", paid: "TRUE" },
      { date: "10/3/2026", type: "Show", place: "Denver Porchfest" },
    ], { musician: "Nico", musicianEmail: "nico@example.com" }),
  });
  const s = gasSurvey(r);
  const reasons = (b: "unclean" | "decide" | "deferred" | "overwrite") => group(s.notes, b).map((g) => g.reason);

  // A Paid row and a drive that can't point at a show are intended outcomes, not problems.
  assert.ok(reasons("deferred").some((x) => /marked Paid/.test(x)), reasons("deferred").join(" | "));
  assert.ok(reasons("deferred").some((x) => /no show/.test(x)), reasons("deferred").join(" | "));
  assert.deepEqual(reasons("unclean"), [], "nothing here is unclean");

  // Who it is all for, by name and email, so a whole-file skip is impossible to miss.
  const out = formatSurvey(s);
  assert.match(out, /musician: Nico Alvarez <nico@example\.com> \(by email\)/, out);
  assert.match(out, /expenses: 3 \(created 2, skipped 1\)/, out);
});

test("a second gas run reports every row unchanged and writes nothing new", async () => {
  await makeNico();
  const snapshot = gasSnapshot([{ date: "6/28/2026", type: "Rehearsal", place: "David's" }], { musician: "Nico", musicianEmail: "nico@example.com" });
  await importGas({ artist: "ingrid-avison-band", snapshot });
  const before = await db.list("expenses");
  const again = await importGas({ artist: "ingrid-avison-band", snapshot });
  assert.deepEqual(again.rows.map((x) => x.action), ["unchanged"]);
  assert.deepEqual(await db.list("expenses"), before, "the fixed id means a re-run never doubles an expense");
  // Nothing to decide and nothing unclean on a re-run: that is the signal the production run is safe.
  assert.match(formatSurvey(gasSurvey(again)), /Would overwrite: none/, formatSurvey(gasSurvey(again)));
});

test("a gas dry run reports what it would create and writes nothing", async () => {
  await makeNico();
  const r = await importGas({
    artist: "ingrid-avison-band", dryRun: true,
    snapshot: gasSnapshot([{ date: "6/28/2026", type: "Rehearsal", place: "David's" }], { musician: "Nico", musicianEmail: "nico@example.com" }),
  });
  assert.equal(r.rows[0].action, "created");
  assert.equal(r.resolved?.musicianName, "Nico Alvarez", "a dry run still resolves the musician");
  assert.deepEqual(await db.list("expenses"), []);
  assert.match(formatSurvey(gasSurvey(r)), /dry run, nothing written/);
});

// ---------- show income: the survey ----------

/** The Shows tab, with only the columns the survey reads. */
const incomeSnapshot = (rows: { date: string; gig: string; guarantee?: string; length?: string; notes?: string }[]) => ({
  source: "test",
  values: [
    ["Date", "Gig", "Guarantee (Check / Venmo)", "Total Income", "Gig Length (minutes)", "Notes", "Audience Count", "Ingie Award Nomination"],
    ...rows.map((r) => [r.date, r.gig, r.guarantee ?? "$100.00", r.guarantee ?? "$100.00", r.length ?? "", r.notes ?? "", "", ""]),
  ],
});

test("the income survey puts an unmatched row in the unclean list with its reason", async () => {
  await makeShow("2026-06-28");
  const r = await importShowIncome({
    artist: "ingrid-avison-band", dryRun: true,
    snapshot: incomeSnapshot([{ date: "6/28/2026", gig: "Hi-Dive" }, { date: "9/14/2026", gig: "Nowhere At All" }]),
  });
  const s = incomeSurvey(r);
  const unclean = group(s.notes, "unclean");
  assert.deepEqual(unclean.map((g) => g.reason), ["no show on that date, so the money has nowhere to go"]);
  assert.equal(unclean[0].rows.length, 1);
  assert.match(unclean[0].rows[0].where!, /line 3 2026-09-14 Nowhere At All/);
  // The row that did match is counted as clean.
  assert.match(formatSurvey(s), /income: 1 \(added 1\)/, formatSurvey(s));
});

test("the income survey flags a date-only match as a human decision", async () => {
  await makeShow("2026-06-28");
  const r = await importShowIncome({
    artist: "ingrid-avison-band", dryRun: true,
    // The name matches no show, but it is the only show that day, so the importer guesses.
    snapshot: incomeSnapshot([{ date: "6/28/2026", gig: "Some Other Name" }]),
  });
  assert.equal(r.rows[0].match, "date-only");
  assert.ok(group(incomeSurvey(r).notes, "decide").some((g) => /matched by date alone/.test(g.reason)));
});

test("the income survey reports a booked set length that disagrees, and lists it under decisions", async () => {
  const show = await makeShow("2026-06-28");
  await cmd("shows.update", { id: show.id, patch: { times: { loadIn: "18:00", set: "20:00", setLengthSec: 90 * 60 } } });
  const r = await importShowIncome({
    artist: "ingrid-avison-band", dryRun: true,
    snapshot: incomeSnapshot([{ date: "6/28/2026", gig: "Hi-Dive", length: "45" }]),
  });
  assert.equal(r.rows[0].setLength, "differs");
  const g = group(incomeSurvey(r).notes, "decide").find((x) => /set length disagrees/.test(x.reason));
  assert.ok(g, "the disagreement needs a human");
  assert.match(g.rows[0].detail!, /booked 90 min, sheet 45 min/);
});

test("a clean income snapshot produces an empty unclean and decide list", async () => {
  await makeShow("2026-06-28");
  const r = await importShowIncome({
    artist: "ingrid-avison-band", dryRun: true,
    snapshot: incomeSnapshot([{ date: "6/28/2026", gig: "Hi-Dive" }]),
  });
  const s = incomeSurvey(r);
  assert.deepEqual(group(s.notes, "unclean"), []);
  assert.deepEqual(group(s.notes, "decide"), []);
  assert.match(formatSurvey(s), /Nothing unclean and nothing to decide: safe to run\./, formatSurvey(s));
});

test("the income survey says whether the ratings columns write or are waiting on story 03", async () => {
  await makeShow("2026-06-28");
  const r = await importShowIncome({
    artist: "ingrid-avison-band", dryRun: true,
    snapshot: incomeSnapshot([{ date: "6/28/2026", gig: "Hi-Dive", notes: "Great room" }]),
  });
  // Story 03 has landed, so they write rather than wait.
  assert.equal(r.ratingsSupported, true);
  assert.match(String(incomeSurvey(r).totals!.ratings), /story 03 landed/);
  assert.deepEqual(group(incomeSurvey(r).notes, "unclean"), []);
});

test("income already on a deal is reported as an overwrite rather than silently replaced", async () => {
  await makeShow("2026-06-28");
  const snapshot = incomeSnapshot([{ date: "6/28/2026", gig: "Hi-Dive" }]);
  await importShowIncome({ artist: "ingrid-avison-band", snapshot });
  // A second run would replace what the first run put there: that belongs in "would overwrite".
  const again = await importShowIncome({ artist: "ingrid-avison-band", dryRun: true, snapshot: incomeSnapshot([{ date: "6/28/2026", gig: "Hi-Dive", guarantee: "$250.00" }]) });
  assert.equal(again.rows[0].incomeAction, "replaced");
  assert.ok(group(incomeSurvey(again).notes, "overwrite").some((g) => /would be replaced/.test(g.reason)));
});
