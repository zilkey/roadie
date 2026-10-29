import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { firestore } from "@/server/admin";
import { migrateShowPage } from "../../scripts/migrate-show-page";
import { resetEmulators } from "./helpers";

beforeEach(resetEmulators);

const base = {
  status: "played", artistId: "a", personnel: [], sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false },
  docs: [], listings: {}, place: { city: "Denver" },
};

/** Production before the show page rebuild: one checklist + gear, set length in minutes, band notes, money in the ledger. */
async function legacyWorld() {
  const ctx = importCtx("old", "old-run");
  const fs = firestore();
  const show = (await db.create(ctx, "shows", {
    ...base, date: "2026-10-10", times: { set: "20:00", setLength: 90 }, bandNotes: "Park behind the building", public: true,
    checklist: [{ id: "c1", label: "Print setlists", done: true, ownerId: "m1" }],
    gear: [{ id: "g1", label: "Bass amp", musicianId: "m2", packed: false }],
  })).id;
  const plain = (await db.create(ctx, "shows", { ...base, date: "2026-11-01", times: {}, checklist: [], gear: [], public: false })).id;
  const upcoming = (await db.create(ctx, "shows", { ...base, status: "confirmed", date: "2027-01-01", times: {}, checklists: [] })).id;
  await db.create(ctx, "showDeals", { contactIds: [], deal: "guarantee", guarantee: 30000, settled: true }, { id: show });
  await db.create(ctx, "showDeals", { contactIds: [], deal: "guarantee", guarantee: 25000, settled: false, owedPayouts: [{ musicianId: "m1", amount: 5000 }] }, { id: plain });
  await db.create(ctx, "showDeals", { contactIds: [], deal: "tips" }, { id: upcoming });
  const x = (await db.create(ctx, "expenses", { userId: "u1", date: "2026-10-10", amount: 2850, category: "gear", what: "Strings", showId: show })).id;
  // the ledger, written as it was (its schema is gone, so straight to Firestore)
  const L = (id: string, d: Record<string, unknown>) => fs.collection("ledger").doc(id).set({ date: "2026-10-10", method: "cash", createdBy: "jeff", deletedAt: null, ...d });
  await L("i1", { kind: "income", amount: 30000, category: "guarantee", method: "check", showId: show });
  await L("i2", { kind: "income", amount: 4000, category: "venmo", method: "venmo", showId: show });
  await L("i3", { kind: "income", amount: 999, category: "merch", showId: show });
  await L("c1", { kind: "correction", amount: 999, category: "merch", reversesId: "i3", showId: show });
  await L("e1", { kind: "expense", amount: 1500, category: "travel", memo: "Gas", showId: show });
  await L("r1", { kind: "reimbursement", amount: 2850, category: "gear", expenseId: x, date: "2026-10-12" });
  await L("p1", { kind: "payout", amount: 10000, category: "other", showId: show });
  await L("n1", { kind: "income", amount: 20000, category: "other", memo: "Photo shoot" });
  return { fs, show, plain, upcoming, x };
}

test("migrate:show-page moves checklists, set length, band notes and ledger money without losing any; a second run changes nothing", async () => {
  const { fs, show, plain, upcoming, x } = await legacyWorld();
  const dry = await migrateShowPage(fs, { dryRun: true });
  assert.equal(dry.shows.length, 2);
  assert.equal((await db.get("shows", show))!.bandNotes, "Park behind the building", "a dry run writes nothing");

  const r = await migrateShowPage(fs);
  assert.deepEqual(r.notMoved, { payouts: 1, owedPayouts: 1, noShow: 1 });

  const s = (await db.get("shows", show))!;
  assert.deepEqual(s.checklists.map((l: any) => [l.name, l.items.map((i: any) => [i.label, i.done, i.ownerId])]),
    [["Gig prep", [["Print setlists", true, "m1"]]], ["Gear", [["Bass amp", false, "m2"]]]]);
  for (const f of ["checklist", "gear", "bandNotes", "public"]) assert.equal(f in s, false, `${f} is gone`);
  assert.equal(s.publishToBandsintown, true, "a public show is published to Bandsintown");
  const p0 = (await db.get("shows", plain))!;
  assert.equal("public" in p0, false); assert.equal(p0.publishToBandsintown, undefined, "a private show just loses the flag");
  assert.deepEqual(s.times, { set: "20:00", setLengthSec: 5400 });
  const comments = await db.list(`shows/${show}/comments`);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].body, "Park behind the building"); assert.equal(comments[0].audience, "band"); assert.equal(comments[0].authorId, s.createdBy);
  assert.deepEqual((await db.get("shows", plain))!.checklists, []);
  assert.equal((await db.get("shows", upcoming))!.rev, 1, "an already-new show is left alone");

  const d = (await db.get("showDeals", show))!;
  assert.deepEqual(d.income.map((l: any) => [l.category, l.amount, l.method, l.received]), [["guarantee", 30000, "check", true], ["tips", 4000, "venmo", true]]);
  assert.equal("guarantee" in d, false);
  const spent = (await db.list("expenses")).filter((e) => e.showId === show).sort((a, b) => a.amount - b.amount);
  assert.deepEqual(spent.map((e) => [e.what, e.amount, e.payBack ?? true, e.userId]), [["Gas", 1500, false, "jeff"], ["Strings", 2850, true, "u1"]]);
  assert.deepEqual([d.totals.income, d.totals.expenses], [0, 4350], "totals count income docs only; the legacy lines reach them when migrate:money runs");
  const p = (await db.get("showDeals", plain))!;
  assert.deepEqual(p.income.map((l: any) => [l.category, l.amount, l.received]), [["guarantee", 25000, false]], "an unpaid guarantee is an income line, not received");
  assert.deepEqual(p.owedPayouts, [{ musicianId: "m1", amount: 5000 }]);
  assert.deepEqual((await db.get("showDeals", upcoming))!.income, []);
  const paid = (await db.get("expenses", x))!;
  assert.equal(paid.paidBackAt, "2026-10-12"); assert.equal(paid.paidBackBy, "jeff");
  assert.equal((await fs.collection("ledger").get()).size, 8, "the ledger is left in place");

  const again = await migrateShowPage(fs);
  assert.deepEqual([again.shows.length, again.deals.length, again.paidBack.length], [0, 0, 0]);
  assert.equal((await db.list(`shows/${show}/comments`)).length, 1);
});
