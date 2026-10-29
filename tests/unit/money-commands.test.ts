import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx, mctx: Ctx;
let memberUid: string;
let band: string, duo: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.GMAIL_BASE_URL = s.running["fake-gmail"].url;
  process.env.CALENDAR_BASE_URL = s.running["fake-calendar"].url;
  process.env.BANDSINTOWN_BASE_URL = s.running["fake-bandsintown"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};
const code = (p: Promise<unknown>, c: string) => assert.rejects(p, (e: any) => e.code === c);

beforeEach(async () => {
  await resetEmulators();
  const a = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  const m = await makeUser("david@example.com", "member", { name: "David" });
  memberUid = m.uid;
  mctx = { uid: m.uid, role: "member", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  await db.create(ctx, "artists", { slug: "band", name: "Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
  band = (await cmd("projects.create", { kind: "band", name: "Band", isDefault: true })).id;
  duo = (await cmd("projects.create", { kind: "duo", name: "Duo" })).id;
  await db.update(ctx, "artists", TEST_ARTIST, { configurations: [
    { id: "full", name: "Full band", billingName: "Full band", musicianIds: [] },
    { id: "duo", name: "Duo", billingName: "The Duo", musicianIds: [], defaultProjectId: duo },
  ] });
});

const defaults = async () => (await db.list("projects")).filter((p) => p.isDefault).map((p) => p.id);
const mkShow = async (extra: Record<string, unknown> = {}) => {
  const id = (await db.create(ctx, "shows", {
    date: "2026-11-10", status: "confirmed", venue: { id: "v", name: "Hi-Dive" }, times: {}, artistId: TEST_ARTIST, personnel: [],
    sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, checklists: [], docs: [], listings: {}, ...extra,
  })).id;
  await db.create(ctx, "showDeals", { contactIds: [], deal: "guarantee" }, { id });
  return id;
};
const dealTotals = async (id: string) => (await db.get("showDeals", id) as any).totals;

test("projects: admin only, exactly one default, close/reopen, closed refuses new money", async () => {
  assert.deepEqual(await defaults(), [band]);
  const album = (await cmd("projects.create", { kind: "album", name: "LP", isDefault: true })).id;
  assert.deepEqual(await defaults(), [album]);
  await cmd("projects.update", { id: band, patch: { isDefault: true } });
  assert.deepEqual(await defaults(), [band]);
  await cmd("projects.close", { id: duo });
  await code(cmd("income.add", { amount: 100, category: "tips", from: "x", projectId: duo }), "invalid_state");
  await code(cmd("expenses.add", { amount: 100, what: "x", category: "gear", projectId: duo }), "invalid_state");
  await cmd("projects.reopen", { id: duo });
  await cmd("income.add", { amount: 100, category: "tips", from: "x", projectId: duo });
  await code(cmd("income.add", { amount: 100, category: "tips", from: "x", projectId: "nope" }), "not_found");
});

test("roles: members can't use the admin money and project commands", async () => {
  for (const name of ["projects.create", "projects.update", "income.add", "income.update", "payouts.add", "payouts.markPaid", "expenses.payPerson"]) {
    assert.ok(!registry[name].roles.includes("member"), name);
  }
  assert.ok(registry["income.add"].roles.includes("mcp") && registry["payouts.add"].roles.includes("mcp"));
  assert.ok(!registry["projects.create"].roles.includes("mcp"));
});

test("income: defaults to the default project, the show's project, owed until setReceived; totals follow", async () => {
  const s = await mkShow({ projectId: duo });
  const plain = await cmd("income.add", { amount: 5000, category: "tips", from: "Bandcamp" });
  assert.equal((await db.get("income", plain.id) as any).projectId, band);
  const g = await cmd("income.add", { amount: 30000, category: "guarantee", from: "Hi-Dive", showId: s });
  let doc = await db.get("income", g.id) as any;
  assert.equal(doc.projectId, duo);
  assert.equal(doc.date, "2026-11-10");
  assert.equal(doc.receivedAt, undefined);
  assert.equal((await dealTotals(s)).income, 30000);
  await cmd("income.setReceived", { id: g.id, receivedAt: "2026-11-11", method: "check" });
  doc = await db.get("income", g.id) as any;
  assert.deepEqual([doc.receivedAt, doc.method], ["2026-11-11", "check"]);
  await cmd("income.update", { id: g.id, patch: { receivedAt: null, amount: 25000 } });
  doc = await db.get("income", g.id) as any;
  assert.equal(doc.receivedAt, undefined);
  assert.equal((await dealTotals(s)).income, 25000);
  const other = await mkShow();
  await cmd("income.update", { id: g.id, patch: { showId: other } });
  // (the old show dropping to 0 needs refreshDealTotals to filter the unit's overlay by showId: reported to the lead)
  assert.equal((await dealTotals(other)).income, 25000);
  await cmd("income.remove", { id: g.id });
  assert.equal((await dealTotals(other)).income, 0);
});

test("payouts: to resolves and copies the name; paidAt missing = owed; markPaid; paidOut in totals", async () => {
  const s = await mkShow();
  const mus = (await db.create(ctx, "musicians", { name: "Sam Drummer", instruments: [], active: true })).id;
  const p = await cmd("payouts.add", { to: { musicianId: mus }, kind: "pay", amount: 6000, showId: s, what: "the show" });
  let doc = await db.get("payouts", p.id) as any;
  assert.deepEqual(doc.to, { musicianId: mus, name: "Sam Drummer" });
  assert.equal(doc.projectId, band);
  assert.equal(doc.paidAt, undefined);
  assert.equal((await dealTotals(s)).paidOut, 6000);
  const u = await cmd("payouts.add", { to: { userId: memberUid }, kind: "other", amount: 100 });
  assert.equal(((await db.get("payouts", u.id)) as any).to.name, "David");
  const n = await cmd("payouts.add", { to: { name: "Other Band" }, kind: "split", amount: 100, projectId: duo });
  assert.deepEqual(((await db.get("payouts", n.id)) as any).to, { name: "Other Band" });
  await code(cmd("payouts.add", { to: { musicianId: "ghost" }, kind: "pay", amount: 100 }), "not_found");
  await code(cmd("payouts.add", { to: { contactId: "ghost" }, kind: "pay", amount: 100 }), "not_found");
  // only an admin can be the payer: the money left their own account
  await code(cmd("payouts.markPaid", { id: p.id, paidAt: "2026-11-12", method: "venmo", paidBy: memberUid }), "invalid_input");
  await code(cmd("payouts.add", { to: { name: "x" }, kind: "pay", amount: 1, paidAt: "2026-11-12", paidBy: "ghost" }), "not_found");
  await cmd("payouts.markPaid", { id: p.id, paidAt: "2026-11-12", method: "venmo", paidBy: ctx.uid });
  doc = await db.get("payouts", p.id) as any;
  assert.deepEqual([doc.paidAt, doc.method, doc.paidBy], ["2026-11-12", "venmo", ctx.uid]);
  await cmd("payouts.update", { id: p.id, patch: { paidBy: null } });
  assert.equal(((await db.get("payouts", p.id)) as any).paidBy, undefined);
  await cmd("payouts.update", { id: p.id, patch: { paidAt: null, amount: 7000 } });
  assert.equal(((await db.get("payouts", p.id)) as any).paidAt, undefined);
  assert.equal((await dealTotals(s)).paidOut, 7000);
  await cmd("projects.close", { id: duo });
  await code(cmd("payouts.add", { to: { name: "x" }, kind: "pay", amount: 1, projectId: duo }), "invalid_state");
  await cmd("payouts.remove", { id: p.id });
  assert.equal((await dealTotals(s)).paidOut, 0);
});

test("expenses: default project, the show's project, admin on behalf, member refused", async () => {
  const s = await mkShow({ projectId: duo });
  const a = await cmd("expenses.add", { amount: 1000, what: "strings", category: "gear" });
  assert.equal(((await db.get("expenses", a.id)) as any).projectId, band);
  const b = await cmd("expenses.add", { amount: 2000, what: "gas", category: "travel", showId: s });
  assert.equal(((await db.get("expenses", b.id)) as any).projectId, duo);
  const c = await cmd("expenses.add", { amount: 4200, what: "gas", category: "travel", userId: memberUid });
  assert.equal(((await db.get("expenses", c.id)) as any).userId, memberUid);
  await code(cmd("expenses.add", { amount: 100, what: "x", category: "gear", userId: "someone-else" }, mctx), "forbidden");
  await cmd("expenses.add", { amount: 100, what: "mine", category: "gear" }, mctx);
  await cmd("expenses.update", { id: a.id, patch: { projectId: duo, category: "lodging" } });
  const up = await db.get("expenses", a.id) as any;
  assert.deepEqual([up.projectId, up.category], [duo, "lodging"]);
  await assert.rejects(cmd("expenses.add", { amount: 100, what: "x", category: "door" }));
  // shows.setExpenses lines take the show's project
  await cmd("shows.setExpenses", { id: s, lines: [{ what: "van", amount: 900 }] });
  const lines = (await db.list("expenses")).filter((x) => x.showId === s && x.what === "van");
  assert.equal(lines[0].projectId, duo);
});

test("expenses: a vendor (to) is resolved and named; an owed bill has no payer until markPaid names an admin", async () => {
  const s = await mkShow();
  const contact = (await db.create(ctx, "contacts", { name: "Doghouse Studio", emails: [], phones: [], matchKey: "doghouse" })).id;
  const paid = await cmd("expenses.add", { amount: 6000, what: "Room rental", category: "space", to: { contactId: contact }, payBack: false, date: "2026-10-03" });
  let doc = await db.get("expenses", paid.id) as any;
  assert.deepEqual([doc.to, doc.owed, doc.userId, doc.date], [{ contactId: contact, name: "Doghouse Studio" }, undefined, ctx.uid, "2026-10-03"]);
  await code(cmd("expenses.add", { amount: 1, what: "x", category: "space", to: { contactId: "ghost" } }), "not_found");
  // a bill nobody has paid yet: no pay-back, counted as owed on the show until it is marked paid
  const bill = await cmd("expenses.add", { amount: 23000, what: "Video studio day", category: "space", to: { name: "Video Studio Space" }, owed: true, showId: s });
  doc = await db.get("expenses", bill.id) as any;
  assert.deepEqual([doc.owed, doc.payBack, doc.to], [true, false, { name: "Video Studio Space" }]);
  await code(cmd("expenses.add", { amount: 1, what: "x", category: "space", owed: true }, mctx), "forbidden");
  await code(cmd("expenses.markPaid", { id: bill.id, userId: memberUid }), "invalid_input");
  await code(cmd("expenses.markPaid", { id: paid.id, userId: ctx.uid }), "invalid_state");
  await cmd("expenses.markPaid", { id: bill.id, userId: ctx.uid, paidAt: "2026-11-01" });
  doc = await db.get("expenses", bill.id) as any;
  assert.deepEqual([doc.owed, doc.userId, doc.date], [undefined, ctx.uid, "2026-11-01"]);
  assert.equal((await dealTotals(s)).expenses, 23000);
  // the vendor can be fixed or cleared; a member can't move an expense to another payer
  await cmd("expenses.update", { id: paid.id, patch: { to: { name: "The Doghouse" } } });
  assert.deepEqual(((await db.get("expenses", paid.id)) as any).to, { name: "The Doghouse" });
  await cmd("expenses.update", { id: paid.id, patch: { to: null, userId: memberUid } });
  doc = await db.get("expenses", paid.id) as any;
  assert.deepEqual([doc.to, doc.userId], [undefined, memberUid]);
  await code(cmd("expenses.update", { id: paid.id, patch: { userId: ctx.uid } }, mctx), "forbidden");
});

test("expenses.payPerson writes one reimbursement payout and reimbursedBy", async () => {
  const s = await mkShow({ projectId: duo });
  const e1 = (await cmd("expenses.add", { amount: 4200, what: "gas", category: "travel", userId: memberUid, showId: s })).id;
  const e2 = (await cmd("expenses.add", { amount: 800, what: "food", category: "food", userId: memberUid, showId: s })).id;
  const ingrid = await makeUser("ingrid@example.com", "admin", { name: "Ingrid" });
  await code(cmd("expenses.payPerson", { userId: memberUid, method: "venmo", paidAt: "2026-11-12", paidBy: memberUid }), "invalid_input");
  const r = await cmd("expenses.payPerson", { userId: memberUid, method: "venmo", paidAt: "2026-11-12", paidBy: ingrid.uid });
  assert.equal(r.total, 5000);
  assert.deepEqual(r.paid.sort(), [e1, e2].sort());
  const p = await db.get("payouts", r.payoutId) as any;
  assert.deepEqual(p.to, { userId: memberUid, name: "David" });
  assert.deepEqual([p.kind, p.amount, p.paidAt, p.method, p.paidBy, p.projectId, p.showId], ["reimbursement", 5000, "2026-11-12", "venmo", ingrid.uid, duo, s]);
  assert.deepEqual([...p.expenseIds].sort(), [e1, e2].sort());
  // the payer who paid the member back is stamped on each expense (the feed says "Ingrid paid David back")
  for (const id of [e1, e2]) {
    const x = await db.get("expenses", id) as any;
    assert.deepEqual([x.reimbursedBy, x.paidBackAt, x.paidBackBy], [r.payoutId, "2026-11-12", ingrid.uid]);
  }
  // a reimbursement repays expenses already counted as spent, so it is not paid out (the show's net would be understated)
  assert.equal((await dealTotals(s)).paidOut, 0);
  assert.equal((await db.list("payouts")).length, 1);
  // a reimbursement payout with expenseIds links the expenses; removing it frees them
  const e3 = (await cmd("expenses.add", { amount: 300, what: "tolls", category: "travel", userId: memberUid })).id;
  const p2 = await cmd("payouts.add", { to: { userId: memberUid }, kind: "reimbursement", amount: 300, expenseIds: [e3] });
  assert.equal(((await db.get("expenses", e3)) as any).reimbursedBy, p2.id);
  await cmd("payouts.remove", { id: p2.id });
  assert.equal(((await db.get("expenses", e3)) as any).reimbursedBy, undefined);
});

test("shows.create: project from the configuration, guarantee becomes an income doc (never income[])", async () => {
  const v = (await db.create(ctx, "venues", venue("Lost Lake"))).id;
  const r = await cmd("shows.create", { date: "2026-12-01", venueId: v, billedAs: "duo", deal: { deal: "guarantee", guarantee: 40000 } });
  const show = await db.get("shows", r.id) as any;
  assert.equal(show.projectId, duo);
  const inc = (await db.list("income")).filter((x) => x.showId === r.id);
  assert.equal(inc.length, 1);
  assert.deepEqual([inc[0].category, inc[0].amount, inc[0].from, inc[0].projectId, inc[0].date, inc[0].receivedAt], ["guarantee", 40000, "Lost Lake", duo, "2026-12-01", undefined]);
  const deal = await db.get("showDeals", r.id) as any;
  assert.equal(deal.income, undefined);
  assert.equal(deal.totals.income, 40000);
  const r2 = await cmd("shows.create", { date: "2026-12-02", venueId: v, billedAs: "full", deal: { deal: "free" } });
  assert.equal(((await db.get("shows", r2.id)) as any).projectId, band);
  assert.equal((await db.list("income")).length, 1);
  await cmd("shows.update", { id: r2.id, patch: { projectId: duo } });
  assert.equal(((await db.get("shows", r2.id)) as any).projectId, duo);
  await cmd("projects.close", { id: band });
  await code(cmd("shows.update", { id: r2.id, patch: { projectId: band } }), "invalid_state");
  const list = await cmd("shows.list", {});
  assert.equal(list.shows.find((x: any) => x.id === r.id).totals.net, 40000);
  assert.equal(registry["showDeals.setIncome"], undefined);
});
