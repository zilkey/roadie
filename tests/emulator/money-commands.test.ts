import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { resetEmulators, makeUser, venue, TEST_ARTIST, SYS } from "./helpers";

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
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};
const code = (p: Promise<unknown>, c: string) => assert.rejects(p, (e: any) => e.code === c);

beforeEach(async () => {
  await resetEmulators();
  const a = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  const m = await makeUser("hugo@example.com", "member", { name: "Hugo" });
  memberUid = m.uid;
  mctx = { uid: m.uid, role: "member", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  await db.create(ctx, "artists", { timeZone: "America/Denver", slug: "band", name: "Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
  band = (await cmd("projects.create", { kind: "band", name: "Band", isDefault: true })).id;
  duo = (await cmd("projects.create", { kind: "duo", name: "Duo" })).id;
  await db.update(ctx, "artists", TEST_ARTIST, { configurations: [
    { id: "full", name: "Full band", billingName: "Full band", musicianIds: [] },
    { id: "duo", name: "Duo", billingName: "The Duo", musicianIds: [], defaultProjectId: duo },
  ] });
});

const defaults = async () => (await db.list(SYS, "projects")).filter((p) => p.isDefault).map((p) => p.id);
const mkShow = async (extra: Record<string, unknown> = {}) => {
  const id = (await db.create(ctx, "shows", {
    date: "2026-11-10", status: "confirmed", venue: { id: "v", name: "Deep End" }, times: {}, artistId: TEST_ARTIST, personnel: [],
    sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, checklists: [], docs: [], ...extra,
  })).id;
  await db.create(ctx, "showDeals", { contactIds: [], deal: "guarantee" }, { id });
  return id;
};
const dealTotals = async (id: string) => (await db.get(SYS, "showDeals", id) as any).totals;

test("projects: admin only, exactly one default, close/reopen, closed refuses new money", async () => {
  assert.deepEqual(await defaults(), [band]);
  const release = (await cmd("projects.create", { kind: "release", name: "LP", isDefault: true })).id;
  assert.deepEqual(await defaults(), [release]);
  await cmd("projects.update", { id: band, patch: { isDefault: true } });
  assert.deepEqual(await defaults(), [band]);
  await cmd("projects.close", { id: duo });
  await code(cmd("income.add", { amount: 100, category: "tips", from: "x", projectId: duo }), "invalid_state");
  await code(cmd("expenses.add", { amount: 100, what: "x", category: "gear", projectId: duo }), "invalid_state");
  await cmd("projects.reopen", { id: duo });
  await cmd("income.add", { amount: 100, category: "tips", from: "x", projectId: duo });
  await code(cmd("income.add", { amount: 100, category: "tips", from: "x", projectId: "nope" }), "not_found");
});

test("projects.remove: only an empty, non-default project goes; one with money on it is closed instead", async () => {
  const scratch = (await cmd("projects.create", { kind: "other", name: "Scratch" })).id;
  await code(cmd("projects.remove", { id: band }), "invalid_state"); // the default
  await cmd("income.add", { amount: 100, category: "tips", from: "x", projectId: scratch });
  await code(cmd("projects.remove", { id: scratch }), "invalid_state"); // money on it
  const empty = (await cmd("projects.create", { kind: "other", name: "Empty" })).id;
  await cmd("projects.remove", { id: empty });
  assert.ok((await db.get(SYS, "projects", empty) as any).deletedAt);
  await code(cmd("projects.remove", { id: empty }), "not_found");
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
  assert.equal((await db.get(SYS, "income", plain.id) as any).projectId, band);
  const g = await cmd("income.add", { amount: 30000, category: "guarantee", from: "Deep End", showId: s });
  let doc = await db.get(SYS, "income", g.id) as any;
  assert.equal(doc.projectId, duo);
  assert.equal(doc.date, "2026-11-10");
  assert.equal(doc.receivedAt, undefined);
  assert.equal((await dealTotals(s)).income, 30000);
  await cmd("income.setReceived", { id: g.id, receivedAt: "2026-11-11", method: "check" });
  doc = await db.get(SYS, "income", g.id) as any;
  assert.deepEqual([doc.receivedAt, doc.method], ["2026-11-11", "check"]);
  await cmd("income.update", { id: g.id, patch: { receivedAt: null, amount: 25000 } });
  doc = await db.get(SYS, "income", g.id) as any;
  assert.equal(doc.receivedAt, undefined);
  assert.equal((await dealTotals(s)).income, 25000);
  const other = await mkShow();
  await cmd("income.update", { id: g.id, patch: { showId: other } });
  // (the old show dropping to 0 needs refreshDealTotals to filter the unit's overlay by showId: reported to the lead)
  assert.equal((await dealTotals(other)).income, 25000);
  await cmd("income.remove", { id: g.id });
  assert.equal((await dealTotals(other)).income, 0);
});

test("income.receivedBy: an admin receiving it in the app gets it; Roadie's stay unassigned; income.assign moves it to another admin only", async () => {
  const got = await cmd("income.add", { amount: 5000, category: "tips", from: "Door", receivedAt: "2026-11-11", method: "cash" });
  assert.equal((await db.get(SYS, "income", got.id) as any).receivedBy, ctx.uid);
  const owed = await cmd("income.add", { amount: 7000, category: "guarantee", from: "Deep End" });
  assert.equal((await db.get(SYS, "income", owed.id) as any).receivedBy, undefined); // not received yet
  await cmd("income.setReceived", { id: owed.id });
  assert.equal((await db.get(SYS, "income", owed.id) as any).receivedBy, ctx.uid);
  const mcp: Ctx = { ...ctx, role: "mcp", uid: "ai" };
  const ai = await cmd("income.add", { amount: 900, category: "merch", from: "Merch table", receivedAt: "2026-11-11" }, mcp);
  assert.equal((await db.get(SYS, "income", ai.id) as any).receivedBy, undefined);
  const other = await makeUser("ingrid@example.com", "admin", { name: "Ingrid" });
  await cmd("income.assign", { id: ai.id, receivedBy: other.uid });
  assert.equal((await db.get(SYS, "income", ai.id) as any).receivedBy, other.uid);
  await code(cmd("income.assign", { id: ai.id, receivedBy: memberUid }), "invalid_input"); // members have no worksheet
  await cmd("income.assign", { id: ai.id, receivedBy: null });
  assert.equal((await db.get(SYS, "income", ai.id) as any).receivedBy, undefined);
  assert.ok(!registry["income.assign"].roles.includes("mcp")); // app only: not a Roadie / MCP tool
});

test("payouts: to resolves and copies the name; paidAt missing = owed; markPaid; paidOut in totals", async () => {
  const s = await mkShow();
  const mus = (await db.create(ctx, "musicians", { name: "Sam Drummer", instruments: [], active: true })).id;
  const p = await cmd("payouts.add", { to: { musicianId: mus }, kind: "pay", amount: 6000, showId: s, what: "the show" });
  let doc = await db.get(SYS, "payouts", p.id) as any;
  assert.deepEqual(doc.to, { musicianId: mus, name: "Sam Drummer" });
  assert.equal(doc.projectId, band);
  assert.equal(doc.paidAt, undefined);
  assert.equal((await dealTotals(s)).paidOut, 6000);
  const u = await cmd("payouts.add", { to: { userId: memberUid }, kind: "other", amount: 100 });
  assert.equal(((await db.get(SYS, "payouts", u.id)) as any).to.name, "Hugo");
  const n = await cmd("payouts.add", { to: { name: "Other Band" }, kind: "split", amount: 100, projectId: duo });
  assert.deepEqual(((await db.get(SYS, "payouts", n.id)) as any).to, { name: "Other Band" });
  await code(cmd("payouts.add", { to: { musicianId: "ghost" }, kind: "pay", amount: 100 }), "not_found");
  await code(cmd("payouts.add", { to: { contactId: "ghost" }, kind: "pay", amount: 100 }), "not_found");
  // only an admin can be the payer: the money left their own account
  await code(cmd("payouts.markPaid", { id: p.id, paidAt: "2026-11-12", method: "venmo", paidBy: memberUid }), "invalid_input");
  await code(cmd("payouts.add", { to: { name: "x" }, kind: "pay", amount: 1, paidAt: "2026-11-12", paidBy: "ghost" }), "not_found");
  await cmd("payouts.markPaid", { id: p.id, paidAt: "2026-11-12", method: "venmo", paidBy: ctx.uid });
  doc = await db.get(SYS, "payouts", p.id) as any;
  assert.deepEqual([doc.paidAt, doc.method, doc.paidBy], ["2026-11-12", "venmo", ctx.uid]);
  await cmd("payouts.update", { id: p.id, patch: { paidBy: null } });
  assert.equal(((await db.get(SYS, "payouts", p.id)) as any).paidBy, undefined);
  await cmd("payouts.update", { id: p.id, patch: { paidAt: null, amount: 7000 } });
  assert.equal(((await db.get(SYS, "payouts", p.id)) as any).paidAt, undefined);
  assert.equal((await dealTotals(s)).paidOut, 7000);
  await cmd("projects.close", { id: duo });
  await code(cmd("payouts.add", { to: { name: "x" }, kind: "pay", amount: 1, projectId: duo }), "invalid_state");
  await cmd("payouts.remove", { id: p.id });
  assert.equal((await dealTotals(s)).paidOut, 0);
});

test("expenses: a person's default project (Settings › Money) beats the default, loses to a show's, is skipped once closed", async () => {
  const tour = (await cmd("projects.create", { kind: "other", name: "Hugo's" })).id;
  assert.ok(!registry["artists.update"].roles.includes("member"));
  await cmd("artists.update", { id: TEST_ARTIST, patch: { expenseProjects: [{ userId: memberUid, projectId: tour }] } });
  const project = async (id: string) => ((await db.get(SYS, "expenses", id)) as any).projectId;
  // Hugo's own, and one an admin logs for him: his project. The admin's own: the default.
  assert.equal(await project((await cmd("expenses.add", { amount: 100, what: "strings", category: "gear" }, mctx)).id), tour);
  assert.equal(await project((await cmd("expenses.add", { amount: 100, what: "strings", category: "gear", userId: memberUid })).id), tour);
  assert.equal(await project((await cmd("expenses.add", { amount: 100, what: "strings", category: "gear" })).id), band);
  // A show's project and one picked on the expense still win.
  const s = await mkShow({ projectId: duo });
  assert.equal(await project((await cmd("expenses.add", { amount: 100, what: "gas", category: "travel", showId: s }, mctx)).id), duo);
  assert.equal(await project((await cmd("expenses.add", { amount: 100, what: "x", category: "gear", projectId: band }, mctx)).id), band);
  // Closed: back to the default, no error.
  await cmd("projects.close", { id: tour });
  assert.equal(await project((await cmd("expenses.add", { amount: 100, what: "strings", category: "gear" }, mctx)).id), band);
});
test("member projects (#86): admins limit what a member files to; a show's own project still works; remove strips it; rehearsal lines use the rehearsal's", async () => {
  const video = (await cmd("projects.create", { kind: "video", name: "Video" })).id;
  const project = async (id: string) => ((await db.get(SYS, "expenses", id)) as any).projectId;
  const entry = async () => ((await db.get(SYS, "artists", TEST_ARTIST)) as any).expenseProjects?.find((x: any) => x.userId === memberUid);
  assert.ok(!registry["artists.setMemberProjects"].roles.includes("member"));
  await code(cmd("artists.setMemberProjects", { userId: "nobody", visibleProjectIds: [band] }), "not_found");
  await cmd("artists.setMemberProjects", { userId: memberUid, visibleProjectIds: [band] });
  assert.deepEqual(await entry(), { userId: memberUid, visibleProjectIds: [band] });
  // Outside the list: refused, unless it's the attached show's own project.
  await code(cmd("expenses.add", { amount: 100, what: "x", category: "gear", projectId: duo }, mctx), "forbidden");
  const s = await mkShow({ projectId: duo });
  assert.equal(await project((await cmd("expenses.add", { amount: 100, what: "gas", category: "gas", showId: s, projectId: duo }, mctx)).id), duo);
  // Changing an expense to a project outside the list is refused; other edits always work; admins aren't limited.
  const mine = await cmd("expenses.add", { amount: 100, what: "strings", category: "gear" }, mctx);
  assert.equal(await project(mine.id), band);
  await code(cmd("expenses.update", { id: mine.id, patch: { projectId: video } }, mctx), "forbidden");
  await cmd("expenses.update", { id: mine.id, patch: { what: "new strings", projectId: band } }, mctx);
  await cmd("expenses.update", { id: mine.id, patch: { projectId: video } });
  // The default counts as fileable; a closed default falls back to the first open project in the list.
  await cmd("artists.setMemberProjects", { userId: memberUid, projectId: video, visibleProjectIds: [duo] });
  assert.equal(await project((await cmd("expenses.add", { amount: 100, what: "x", category: "gear", projectId: video }, mctx)).id), video);
  await cmd("projects.close", { id: video });
  assert.equal(await project((await cmd("expenses.add", { amount: 100, what: "y", category: "gear" }, mctx)).id), duo);
  // Clearing the list: back to every project. Removing a project strips it from every entry.
  await cmd("artists.setMemberProjects", { userId: memberUid, visibleProjectIds: null });
  assert.deepEqual(await entry(), { userId: memberUid, projectId: video });
  const spare = (await cmd("projects.create", { kind: "other", name: "Spare" })).id;
  await cmd("artists.setMemberProjects", { userId: memberUid, projectId: spare, visibleProjectIds: [spare] });
  await cmd("projects.remove", { id: spare });
  assert.equal(await entry(), undefined);
  // rehearsals.setExpenses lines land on the rehearsal's project (not the default).
  const rid = (await db.create(ctx, "rehearsals", { date: "2026-11-12", projectId: duo, artistId: TEST_ARTIST, personnel: [], songs: [] })).id;
  const r = await cmd("rehearsals.setExpenses", { id: rid, lines: [{ what: "Room", amount: 4000, payBack: true }] }, mctx);
  assert.equal(await project(r.added[0]), duo);
});
test("expenses: default project, the show's project, admin on behalf, member refused", async () => {
  const s = await mkShow({ projectId: duo });
  const a = await cmd("expenses.add", { amount: 1000, what: "strings", category: "gear" });
  assert.equal(((await db.get(SYS, "expenses", a.id)) as any).projectId, band);
  const b = await cmd("expenses.add", { amount: 2000, what: "gas", category: "travel", showId: s });
  assert.equal(((await db.get(SYS, "expenses", b.id)) as any).projectId, duo);
  const c = await cmd("expenses.add", { amount: 4200, what: "gas", category: "travel", userId: memberUid });
  assert.equal(((await db.get(SYS, "expenses", c.id)) as any).userId, memberUid);
  await code(cmd("expenses.add", { amount: 100, what: "x", category: "gear", userId: "someone-else" }, mctx), "forbidden");
  await cmd("expenses.add", { amount: 100, what: "mine", category: "gear" }, mctx);
  await cmd("expenses.update", { id: a.id, patch: { projectId: duo, category: "lodging" } });
  const up = await db.get(SYS, "expenses", a.id) as any;
  assert.deepEqual([up.projectId, up.category], [duo, "lodging"]);
  await assert.rejects(cmd("expenses.add", { amount: 100, what: "x", category: "door" }));
  // shows.setExpenses lines take the show's project
  await cmd("shows.setExpenses", { id: s, lines: [{ what: "van", amount: 900 }] });
  const lines = (await db.list(SYS, "expenses")).filter((x) => x.showId === s && x.what === "van");
  assert.equal(lines[0].projectId, duo);
});

test("expenses: notes are optional details under the title; update sets them, null clears, blank is refused", async () => {
  const a = await cmd("expenses.add", { amount: 162500, what: "Mixing 1/4 (Rudy)", notes: "8 songs, two $6,500 invoices", category: "mixing" });
  assert.equal(((await db.get(SYS, "expenses", a.id)) as any).notes, "8 songs, two $6,500 invoices");
  const b = await cmd("expenses.add", { amount: 500, what: "Strings", category: "gear" });
  assert.equal(((await db.get(SYS, "expenses", b.id)) as any).notes, undefined);
  await cmd("expenses.update", { id: b.id, patch: { notes: "  D'Addario 12s  " } });
  assert.equal(((await db.get(SYS, "expenses", b.id)) as any).notes, "D'Addario 12s");
  await cmd("expenses.update", { id: b.id, patch: { notes: null } });
  assert.equal(((await db.get(SYS, "expenses", b.id)) as any).notes, undefined);
  await assert.rejects(cmd("expenses.update", { id: b.id, patch: { notes: "   " } }));
});

test("expenses: a vendor (to) is resolved and named; an owed bill has no payer until markPaid names an admin", async () => {
  const s = await mkShow();
  const contact = (await db.create(ctx, "contacts", { artistId: TEST_ARTIST, name: "Woodshed Studio", emails: [], phones: [], matchKey: "woodshed" })).id;
  const paid = await cmd("expenses.add", { amount: 6000, what: "Room rental", category: "space", to: { contactId: contact }, payBack: false, date: "2026-10-03" });
  let doc = await db.get(SYS, "expenses", paid.id) as any;
  assert.deepEqual([doc.to, doc.owed, doc.userId, doc.date], [{ contactId: contact, name: "Woodshed Studio" }, undefined, ctx.uid, "2026-10-03"]);
  await code(cmd("expenses.add", { amount: 1, what: "x", category: "space", to: { contactId: "ghost" } }), "not_found");
  // a bill nobody has paid yet: no pay-back, counted as owed on the show until it is marked paid
  const bill = await cmd("expenses.add", { amount: 23000, what: "Video studio day", category: "space", to: { name: "Video Studio Space" }, owed: true, showId: s });
  doc = await db.get(SYS, "expenses", bill.id) as any;
  assert.deepEqual([doc.owed, doc.payBack, doc.to], [true, false, { name: "Video Studio Space" }]);
  await code(cmd("expenses.add", { amount: 1, what: "x", category: "space", owed: true }, mctx), "forbidden");
  await code(cmd("expenses.markPaid", { id: bill.id, userId: memberUid }), "invalid_input");
  await code(cmd("expenses.markPaid", { id: paid.id, userId: ctx.uid }), "invalid_state");
  await cmd("expenses.markPaid", { id: bill.id, userId: ctx.uid, paidAt: "2026-11-01" });
  doc = await db.get(SYS, "expenses", bill.id) as any;
  assert.deepEqual([doc.owed, doc.userId, doc.date], [undefined, ctx.uid, "2026-11-01"]);
  assert.equal((await dealTotals(s)).expenses, 23000);
  // the vendor can be fixed or cleared; a member can't move an expense to another payer
  await cmd("expenses.update", { id: paid.id, patch: { to: { name: "The Woodshed" } } });
  assert.deepEqual(((await db.get(SYS, "expenses", paid.id)) as any).to, { name: "The Woodshed" });
  await cmd("expenses.update", { id: paid.id, patch: { to: null, userId: memberUid } });
  doc = await db.get(SYS, "expenses", paid.id) as any;
  assert.deepEqual([doc.to, doc.userId], [undefined, memberUid]);
  await code(cmd("expenses.update", { id: paid.id, patch: { userId: ctx.uid } }, mctx), "forbidden");
});

test("expenses.payPerson writes one reimbursement payout and reimbursedBy", async () => {
  const s = await mkShow({ projectId: duo });
  const e1 = (await cmd("expenses.add", { amount: 4200, what: "gas", category: "travel", userId: memberUid, showId: s })).id;
  const e2 = (await cmd("expenses.add", { amount: 800, what: "food", category: "food", userId: memberUid, showId: s })).id;
  const nora = await makeUser("nora@example.com", "admin", { name: "Nora" });
  await code(cmd("expenses.payPerson", { userId: memberUid, method: "venmo", paidAt: "2026-11-12", paidBy: memberUid }), "invalid_input");
  const r = await cmd("expenses.payPerson", { userId: memberUid, method: "venmo", paidAt: "2026-11-12", paidBy: nora.uid });
  assert.equal(r.total, 5000);
  assert.deepEqual(r.paid.sort(), [e1, e2].sort());
  const p = await db.get(SYS, "payouts", r.payoutId) as any;
  assert.deepEqual(p.to, { userId: memberUid, name: "Hugo" });
  assert.deepEqual([p.kind, p.amount, p.paidAt, p.method, p.paidBy, p.projectId, p.showId], ["reimbursement", 5000, "2026-11-12", "venmo", nora.uid, duo, s]);
  assert.deepEqual([...p.expenseIds].sort(), [e1, e2].sort());
  // the payer who paid the member back is stamped on each expense (the feed says "Nora paid Hugo back")
  for (const id of [e1, e2]) {
    const x = await db.get(SYS, "expenses", id) as any;
    assert.deepEqual([x.reimbursedBy, x.paidBackAt, x.paidBackBy], [r.payoutId, "2026-11-12", nora.uid]);
  }
  // a reimbursement repays expenses already counted as spent, so it is not paid out (the show's net would be understated)
  assert.equal((await dealTotals(s)).paidOut, 0);
  assert.equal((await db.list(SYS, "payouts")).length, 1);
  // a reimbursement payout with expenseIds links the expenses; removing it frees them
  const e3 = (await cmd("expenses.add", { amount: 300, what: "tolls", category: "travel", userId: memberUid })).id;
  const p2 = await cmd("payouts.add", { to: { userId: memberUid }, kind: "reimbursement", amount: 300, expenseIds: [e3] });
  assert.equal(((await db.get(SYS, "expenses", e3)) as any).reimbursedBy, p2.id);
  await cmd("payouts.remove", { id: p2.id });
  assert.equal(((await db.get(SYS, "expenses", e3)) as any).reimbursedBy, undefined);
});

test("shows.create: project from the configuration, guarantee becomes an income doc (never income[])", async () => {
  const v = (await db.create(ctx, "venues", venue("Pine Hollow"))).id;
  const r = await cmd("shows.create", { date: "2026-12-01", venueId: v, billedAs: "duo", deal: { deal: "guarantee", guarantee: 40000 } });
  const show = await db.get(SYS, "shows", r.id) as any;
  assert.equal(show.projectId, duo);
  const inc = (await db.list(SYS, "income")).filter((x) => x.showId === r.id);
  assert.equal(inc.length, 1);
  assert.deepEqual([inc[0].category, inc[0].amount, inc[0].from, inc[0].projectId, inc[0].date, inc[0].receivedAt], ["guarantee", 40000, "Pine Hollow", duo, "2026-12-01", undefined]);
  const deal = await db.get(SYS, "showDeals", r.id) as any;
  assert.equal(deal.income, undefined);
  assert.equal(deal.totals.income, 40000);
  const r2 = await cmd("shows.create", { date: "2026-12-02", venueId: v, billedAs: "full", deal: { deal: "free" } });
  assert.equal(((await db.get(SYS, "shows", r2.id)) as any).projectId, band);
  assert.equal((await db.list(SYS, "income")).length, 1);
  await cmd("shows.update", { id: r2.id, patch: { projectId: duo } });
  assert.equal(((await db.get(SYS, "shows", r2.id)) as any).projectId, duo);
  await cmd("projects.close", { id: band });
  await code(cmd("shows.update", { id: r2.id, patch: { projectId: band } }), "invalid_state");
  const list = await cmd("shows.list", {});
  assert.equal(list.shows.find((x: any) => x.id === r.id).totals.net, 40000);
  assert.equal(registry["showDeals.setIncome"], undefined);
});
