/**
 * Acceptance tests for migrate:money: the Band and Duo projects, every configuration's default project, projectId on shows
 * and expenses, a legacy income-type expense category rewritten to other, each deal income line copied to an income doc
 * (received or owed), every show's net unchanged, a second run changing nothing, and a dry run that reports without writing.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { firestore } from "@/server/admin";
import { undoRun } from "@/server/undo";
import { migrateMoney, moneySurvey } from "../../scripts/migrate-money";
import { resetEmulators } from "./helpers";

beforeEach(resetEmulators);

const ARTIST = "band-a";
const old = importCtx("old", "old-run");
const show = (id: string, date: string, extra: Record<string, unknown> = {}) =>
  db.create(old, "shows", {
    artistId: ARTIST, date, status: "played", venue: { id: "v1", name: "Hi-Dive" }, times: {}, sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, docs: [],
    listings: {}, checklists: [], personnel: [], ...extra,
  }, { id });
const deal = (id: string, income: unknown[]) => db.create(old, "showDeals", { contactIds: [], deal: "guarantee", income }, { id });

async function world() {
  await db.create(old, "artists", {
    slug: "band-a", name: "Band A", links: {}, driveFolderId: "",
    configurations: [
      { id: "full", name: "Full band", billingName: "Band A", musicianIds: [] },
      { id: "duo", name: "Ingrid + Jeff Duo", billingName: "Band A Duo", musicianIds: [] },
    ],
  }, { id: ARTIST });
  await db.create(old, "users", { email: "d@example.com", name: "David", artists: [{ artistId: ARTIST, role: "member" }] }, { id: "david" });
  await show("s1", "2026-10-10", { billedAs: "full" });
  await show("s2", "2026-10-11", { billedAs: "duo", venue: undefined, hostName: "Dana's porch" });
  await show("s3", "2026-10-12", { billedAs: "ghost" });
  await deal("s1", [
    { id: "g", category: "guarantee", amount: 45000, method: "check", received: true },
    { id: "d", category: "door", amount: 12050, received: true },
    { id: "z", category: "tips", amount: 0, received: true },
  ]);
  await deal("s2", [{ id: "g", category: "guarantee", amount: 20000, received: false }]);
  await db.create(old, "expenses", { userId: "david", date: "2026-10-10", amount: 2850, category: "gear", what: "Strings", showId: "s1" }, { id: "e1" });
  await db.create(old, "expenses", { userId: "david", date: "2026-10-01", amount: 1000, category: "tips", what: "Mis-entered", }, { id: "e2" });
}

const incomeDocs = async () => (await db.list("income")).filter((d) => !d.deletedAt);
const count = async () => ({
  projects: (await db.list("projects")).length, income: (await incomeDocs()).length,
  revs: (await db.list("shows")).map((s) => s.rev).join(","),
});

test("migrate:money creates the projects, stamps shows and expenses, copies income lines, and keeps every net", async () => {
  await world();
  const r = await migrateMoney(firestore());

  const projects = await db.list("projects");
  const band = projects.find((p) => p.kind === "band")!, duo = projects.find((p) => p.kind === "duo")!;
  assert.equal(projects.length, 2);
  assert.deepEqual([band.isDefault, band.status, band.artistId], [true, "open", ARTIST]);
  assert.equal(duo.name, "Ingrid + Jeff Duo");
  const cfgs = ((await db.get("artists", ARTIST))!.configurations as { id: string; defaultProjectId: string }[]);
  assert.deepEqual(cfgs.map((c) => c.defaultProjectId), [band.id, duo.id]);

  assert.equal((await db.get("shows", "s1"))!.projectId, band.id);
  assert.equal((await db.get("shows", "s2"))!.projectId, duo.id);
  assert.equal((await db.get("shows", "s3"))!.projectId, band.id, "an unknown billedAs falls back to Band");
  assert.equal((await db.get("expenses", "e1"))!.projectId, band.id);
  const e2 = (await db.get("expenses", "e2"))!;
  assert.deepEqual([e2.projectId, e2.category], [band.id, "other"]);
  assert.deepEqual(r.expensesRewritten, [{ id: "e2", was: "tips" }]);

  const income = await incomeDocs();
  assert.equal(income.length, 3, "the $0 line is not copied");
  const g1 = income.find((i) => i.sourceKey === "s1:g")!;
  assert.deepEqual([g1.amount, g1.category, g1.method, g1.date, g1.receivedAt, g1.from, g1.projectId, g1.showId, g1.artistId],
    [45000, "guarantee", "check", "2026-10-10", "2026-10-10", "Hi-Dive", band.id, "s1", ARTIST]);
  const owed = income.find((i) => i.sourceKey === "s2:g")!;
  assert.equal(owed.receivedAt, undefined);
  assert.deepEqual([owed.from, owed.projectId], ["Dana's porch", duo.id]);
  assert.equal(income.find((i) => i.sourceKey === "s1:d")!.method, undefined);

  // the deal's legacy lines stay as data
  assert.equal(((await db.get("showDeals", "s1"))!.income as unknown[]).length, 3);

  // net invariant: per show, income docs == the deal's income lines
  for (const showId of ["s1", "s2"]) {
    const lines = ((await db.get("showDeals", showId))!.income as { amount: number }[]).reduce((t, l) => t + l.amount, 0);
    const docs = income.filter((i) => i.showId === showId).reduce((t, i) => t + (i.amount as number), 0);
    assert.equal(docs, lines);
  }
  assert.deepEqual(r.nets.map((n) => n.legacy === n.income), [true, true]);
  assert.equal(((await db.get("showDeals", "s1"))!.totals as { income: number }).income, 57050);

  const s = moneySurvey(r);
  assert.ok(s.notes.some((n) => /does not exist/.test(n.reason)));
  assert.ok(s.notes.some((n) => /no amount/.test(n.reason)));
  assert.ok(s.notes.some((n) => /income category/.test(n.reason)));
});

test("migrate:money run twice changes nothing the second time", async () => {
  await world();
  await migrateMoney(firestore());
  const first = await count();
  const again = await migrateMoney(firestore());
  assert.deepEqual(await count(), first);
  assert.deepEqual([again.projectsCreated.length, again.showsSet, again.expensesSet, again.incomeCreated.length, again.configurationsSet], [0, 0, 0, 0, 0]);
  assert.equal(again.incomeSkipped.filter((i) => i.why === "already migrated").length, 3);
});

test("migrate:money --dry-run writes nothing but reports what it would do, and one Undo reverses a real run", async () => {
  await world();
  const before = await count();
  const dry = await migrateMoney(firestore(), { dryRun: true });
  assert.deepEqual(await count(), before);
  assert.equal((await db.get("shows", "s1"))!.projectId, undefined);
  assert.equal((await db.get("expenses", "e2"))!.category, "tips");
  assert.deepEqual([dry.projectsCreated.length, dry.showsSet, dry.expensesSet, dry.incomeCreated.length, dry.configurationsSet], [2, 3, 2, 3, 2]);
  // the dry run's shows saw the projects its first step would have created
  assert.deepEqual(dry.nets.map((n) => n.legacy === n.income), [true, true]);

  const real = await migrateMoney(firestore());
  assert.equal((await incomeDocs()).length, 3);
  await undoRun(importCtx("undo"), real.runId);
  assert.equal((await incomeDocs()).length, 0);
  assert.equal((await db.get("shows", "s1"))!.projectId, undefined);
  assert.equal((await db.list("projects")).filter((p) => !p.deletedAt).length, 0);
});
