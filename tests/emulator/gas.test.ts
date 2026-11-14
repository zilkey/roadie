/**
 * Acceptance tests for the gas estimate: the math, the EIA price-area ladder, estimateGas's missing-info answers
 * (never a throw; the saved home comes back as homeAddress), the save flags writing only the caller's settings, and the fuelPrices cache
 * (stale → fetch; failed fetch → the stored price).
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Timestamp } from "firebase-admin/firestore";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { firestore } from "@/server/admin";
import { newRunId, type Ctx } from "@/server/ctx";
import { AppError } from "@/server/errors";
import { areaFor, priceFor, productFor } from "@/server/gas/price";
import { getDriving, updateDriving as saveDriving, type DrivingPatch } from "@/server/driving";
import { resetEmulators, makeUser, makeArtist } from "./helpers";
import { migrateDriving } from "../../scripts/migrate-driving";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx, mctx: Ctx;
let memberUid: string;
let rehearsalId: string;

// What the fakes return, fixed so every number here and in e2e is deterministic (see fakes/fake-ors and fakes/fake-eia):
// directions: 18.4 mi one way (29611.93 m); EIA: $3.790/gal regular, week 2026-10-19, for every area.
const HOME = { address: "742 Evergreen Terrace, Denver, CO, USA", lat: 39.7005, lng: -104.9503 };
const LOFT = { name: "The Attic", address: "2363 Alder St, Denver, CO, USA", lat: 39.7526, lng: -104.9868 };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  for (const [name, env] of [["fake-ors", "ORS_BASE_URL"], ["fake-eia", "EIA_BASE_URL"], ["fake-drive", "DRIVE_BASE_URL"]] as const) {
    if (s.running[name]) process.env[env] = s.running[name].url;
  }
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

/** Save someone's driving settings as the admin, each in its own run. */
const setDriving = (uid: string, patch: DrivingPatch) => saveDriving({ ...ctx, runId: newRunId() }, uid, patch);
const mpgOf = async (uid: string) => (await getDriving(uid)).cars?.[0]?.mpg;

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};

beforeEach(async () => {
  await resetEmulators();
  await makeArtist("Test Band", "test-band"); // a gas expense lands on the artist's default project
  const a = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId() };
  const m = await makeUser("hugo@example.com", "member", { name: "Hugo" });
  memberUid = m.uid;
  mctx = { uid: m.uid, role: "member", via: "app", runId: newRunId() };
  rehearsalId = (await db.create(ctx, "rehearsals", { date: "2026-10-29", location: LOFT, personnel: [], songs: [] })).id;
});

// ---------- pure ----------

// ---------- estimateGas ----------

test("estimateGas: full info gives the frozen numbers; home never leaves the server", async () => {
  await setDriving(memberUid, { home: HOME, cars: [{ name: "Subaru", mpg: 28, fuelGrade: "regular" }] });
  const r = await cmd("expenses.estimateGas", { rehearsalId }, mctx);
  assert.deepEqual(r.missing, []);
  assert.equal(r.fromKind, "home");
  assert.equal(r.roundTrip, true);
  assert.ok(Math.abs(r.oneWayMiles - 18.4) < 0.01, `oneWayMiles ${r.oneWayMiles}`);
  assert.ok(Math.abs(r.miles - 36.8) < 0.02, `miles ${r.miles}`);
  assert.equal(r.mpg, 28);
  assert.equal(r.priceMilli, 3790);
  assert.equal(r.priceArea, "Denver");
  assert.equal(r.priceWeek, "2026-10-19");
  assert.equal(r.grade, "regular");
  assert.ok(r.seriesId);
  assert.equal(r.estimateCents, 498);
  assert.match(r.source, /EIA/);
  assert.equal(r.homeAddress, HOME.address, "the saved home comes back so the form can show it");
  const oneWay = await cmd("expenses.estimateGas", { rehearsalId, roundTrip: false }, mctx);
  assert.equal(oneWay.estimateCents, 249);
});

test("estimateGas: missing info comes back named, one gap at a time, and never throws", async () => {
  // no MPG: everything else present
  await setDriving(memberUid, { home: HOME });
  const noMpg = await cmd("expenses.estimateGas", { rehearsalId }, mctx);
  assert.deepEqual(noMpg.missing, ["mpg"]);
  assert.ok(Math.abs(noMpg.oneWayMiles - 18.4) < 0.01, "distance still comes back");
  assert.equal(noMpg.estimateCents, undefined);
  // typed mpg fills the gap without saving anything
  const typedMpg = await cmd("expenses.estimateGas", { rehearsalId, mpg: 28 }, mctx);
  assert.deepEqual(typedMpg.missing, []);
  assert.equal(typedMpg.estimateCents, 498);
  assert.equal(await mpgOf(memberUid), undefined);
  // no home: mpg saved, no from
  await setDriving(memberUid, { home: null, cars: [{ name: "Car", mpg: 28 }] });
  const noHome = await cmd("expenses.estimateGas", { rehearsalId }, mctx);
  assert.deepEqual(noHome.missing, ["home"]);
  // a typed From fills it
  const typedFrom = await cmd("expenses.estimateGas", { rehearsalId, from: { address: HOME.address, lat: HOME.lat, lng: HOME.lng } }, mctx);
  assert.deepEqual(typedFrom.missing, []);
  assert.equal(typedFrom.fromKind, "typed");
  // no destination: home and mpg saved, no rehearsal location and no `to`
  await setDriving(memberUid, { home: HOME });
  const bare = (await db.create(ctx, "rehearsals", { date: "2026-11-05", personnel: [], songs: [] })).id;
  const noDest = await cmd("expenses.estimateGas", { rehearsalId: bare }, mctx);
  assert.deepEqual(noDest.missing, ["destination"]);
  const noDest2 = await cmd("expenses.estimateGas", {}, mctx);
  assert.deepEqual(noDest2.missing, ["destination"]);
});

test("estimateGas for a bandmate: admins only, uses their settings, returns miles and their home address", async () => {
  await setDriving(memberUid, { home: HOME, cars: [{ name: "Car", mpg: 28 }] });
  const r = await cmd("expenses.estimateGas", { forId: memberUid, rehearsalId }, ctx);
  assert.deepEqual(r.missing, []);
  assert.equal(r.fromKind, "home");
  assert.equal(r.mpg, 28);
  assert.equal(r.estimateCents, 498);
  assert.equal(r.homeAddress, HOME.address, "admins see the bandmate's home");
  await assert.rejects(cmd("expenses.estimateGas", { forId: ctx.uid, rehearsalId }, mctx), (e: AppError) => e.code === "forbidden");
  // the bandmate's gaps are asked for the same way (admin enters them for this expense only)
  await setDriving(memberUid, { cars: [] });
  const gap = await cmd("expenses.estimateGas", { forId: memberUid, rehearsalId }, ctx);
  assert.deepEqual(gap.missing, ["mpg"]);
});

// ---------- the saved expense ----------

const gasFrom = (r: Record<string, any>) => ({
  fromKind: r.fromKind, to: LOFT, oneWayMiles: r.oneWayMiles, roundTrip: r.roundTrip, miles: r.miles,
  mpg: r.mpg, grade: r.grade, priceMilli: r.priceMilli, priceArea: r.priceArea, priceWeek: r.priceWeek, seriesId: r.seriesId, estimateCents: r.estimateCents,
});

test("a gas expense from a home trip keeps that day's home address, the rehearsal's address and the car; overridden follows the amount", async () => {
  await setDriving(memberUid, { home: HOME, cars: [{ name: "Car", mpg: 28 }] });
  const est = await cmd("expenses.estimateGas", { rehearsalId }, mctx);
  const { id } = await cmd("expenses.add", { amount: est.estimateCents, what: "Gas", category: "travel", rehearsalId, gas: { ...gasFrom(est), to: { name: LOFT.name } } }, mctx);
  const x = (await db.get("expenses", id)) as any;
  assert.equal(x.rehearsalId, rehearsalId);
  assert.equal(x.gas.fromKind, "home");
  assert.equal(x.gas.fromText, HOME.address, "the home address that day is kept");
  assert.equal(x.gas.to.address, LOFT.address, "the rehearsal's address fills a missing To");
  assert.equal(x.gas.carName, "Car");
  assert.equal(x.gas.overridden, false);
  assert.equal(x.gas.estimateCents, 498);
  // moving later doesn't rewrite it
  await setDriving(memberUid, { home: { address: "1 New Place, Boulder, CO", lat: 40, lng: -105 } });
  assert.equal(((await db.get("expenses", id)) as any).gas.fromText, HOME.address);
  // typing a different amount up front marks it overridden but keeps the estimate
  const { id: id2 } = await cmd("expenses.add", { amount: 600, what: "Gas", category: "travel", rehearsalId, gas: gasFrom(est) }, mctx);
  const y = (await db.get("expenses", id2)) as any;
  assert.equal(y.gas.overridden, true);
  assert.equal(y.gas.estimateCents, 498);
  assert.equal(y.amount, 600);
});

test("the save flags write the payer's settings: the driver an admin logs for, else the caller", async () => {
  await setDriving(ctx.uid, { cars: [{ name: "Van", mpg: 22 }] });
  await setDriving(memberUid, { home: HOME });
  const est = await cmd("expenses.estimateGas", { forId: memberUid, rehearsalId, mpg: 31 }, ctx);
  await cmd("expenses.add", { amount: est.estimateCents, what: "Gas", category: "gas", userId: memberUid, rehearsalId, gas: gasFrom(est), saveMpg: true }, ctx);
  assert.equal(await mpgOf(ctx.uid), 22, "the admin's own MPG is untouched");
  const d = await getDriving(memberUid);
  assert.deepEqual(d.cars?.map((c) => [c.name, c.mpg]), [["Car", 31]], "with no car, the MPG makes one");
  assert.deepEqual(d?.home, HOME);
  // saveAsHome writes the member's own home when they typed their From
  await setDriving(memberUid, { home: null });
  const typed = await cmd("expenses.estimateGas", { rehearsalId, from: { address: HOME.address, lat: HOME.lat, lng: HOME.lng } }, mctx);
  await cmd("expenses.add", {
    amount: typed.estimateCents, what: "Gas", category: "travel", rehearsalId,
    gas: { ...gasFrom(typed), fromText: HOME.address }, saveAsHome: HOME,
  }, mctx);
  assert.deepEqual((await getDriving(memberUid))?.home, HOME);
});

test("setAsRehearsalLocation (admins): the typed To becomes the rehearsal's location", async () => {
  await setDriving(ctx.uid, { home: HOME, cars: [{ name: "Van", mpg: 28 }] });
  const bare = (await db.create(ctx, "rehearsals", { date: "2026-11-05", personnel: [], songs: [] })).id;
  const est = await cmd("expenses.estimateGas", { rehearsalId: bare, to: { name: LOFT.name, address: LOFT.address, lat: LOFT.lat, lng: LOFT.lng } }, ctx);
  assert.deepEqual(est.missing, []);
  await cmd("expenses.add", {
    amount: est.estimateCents, what: "Gas", category: "travel", rehearsalId: bare,
    gas: gasFrom(est), setAsRehearsalLocation: { name: LOFT.name, address: LOFT.address, lat: LOFT.lat, lng: LOFT.lng },
  }, ctx);
  const r = (await db.get("rehearsals", bare)) as any;
  assert.equal(r.location?.address, LOFT.address);
  assert.equal(r.location?.name, LOFT.name);
  assert.equal(r.location?.lat, LOFT.lat);
  assert.equal(r.location?.lng, LOFT.lng);
});

test("setAsRehearsalLocation: a member is refused and the rehearsal's location is untouched", async () => {
  await assert.rejects(
    cmd("expenses.add", {
      amount: 500, what: "Gas", category: "travel", rehearsalId,
      setAsRehearsalLocation: { name: "Elsewhere", address: "1 Other St, Denver, CO, USA", lat: 39.7, lng: -105 },
    }, mctx),
    (e: any) => e instanceof AppError && e.status === 403,
  );
  const r = (await db.get("rehearsals", rehearsalId)) as any;
  assert.equal(r.location?.address, LOFT.address);
});

// ---------- moving the old private settings ----------

test("migrate:driving moves users/{uid}/private/driving onto the users doc as one car, deletes the old doc, and is safe to rerun", async () => {
  const old = (uid: string) => firestore().doc(`users/${uid}/private/driving`);
  await old(memberUid).set({ home: HOME, carName: "2010 Honda Fit", mpg: 30, fuelGrade: "regular", updatedAt: Timestamp.now() });
  await old(ctx.uid).set({ mpg: 22, fuelGrade: "midgrade", updatedAt: Timestamp.now() }); // MPG but no car name
  const dry = await migrateDriving({ apply: false });
  assert.equal(dry.moved.length, 2);
  assert.deepEqual(await getDriving(memberUid), {}, "a dry run changes nothing");
  assert.ok((await old(memberUid).get()).exists);

  const r = await migrateDriving({ apply: true });
  assert.equal(r.moved.length, 2);
  const m = await getDriving(memberUid);
  assert.deepEqual(m.home, HOME);
  assert.deepEqual(m.cars?.map((c) => [c.name, c.mpg, c.fuelGrade]), [["2010 Honda Fit", 30, "regular"]]);
  assert.deepEqual((await getDriving(ctx.uid)).cars?.map((c) => [c.name, c.mpg, c.fuelGrade]), [["Car", 22, "midgrade"]]);
  assert.equal((await old(memberUid).get()).exists, false, "the old doc is gone");
  // the estimate reads the moved settings
  assert.equal((await cmd("expenses.estimateGas", { rehearsalId }, mctx)).estimateCents, 465);

  const again = await migrateDriving({ apply: true });
  assert.equal(again.moved.length, 0);
});

// ---------- the price cache ----------

test("fuelPrices: a stale doc triggers a fetch; a failed fetch falls back to the stored price; a fresh doc is not refetched", async () => {
  const area = areaFor("Denver County", "CO");
  const seriesId = `${area.duoarea}_${productFor("regular")}`;
  const ref = firestore().doc(`fuelPrices/${seriesId}`);
  const staleAt = Timestamp.fromMillis(Date.now() - 8 * 86400_000);
  await ref.set({ area: "Denver", areaKind: "metro", grade: "regular", priceMilli: 3500, week: "2026-09-28", fetchedAt: staleAt });
  const fresh = await priceFor(area, "regular");
  assert.equal(fresh?.priceMilli, 3790, "stale → refetched from EIA");
  assert.equal(fresh?.week, "2026-10-19");
  assert.equal((await ref.get()).data()?.priceMilli, 3790, "and stored");
  // fresh: served from the doc without calling EIA
  await ref.set({ area: "Denver", areaKind: "metro", grade: "regular", priceMilli: 3600, week: "2026-10-12", fetchedAt: Timestamp.now() });
  assert.equal((await priceFor(area, "regular"))?.priceMilli, 3600);
  // stale again, but EIA is down: the stored price still answers
  await ref.set({ area: "Denver", areaKind: "metro", grade: "regular", priceMilli: 3650, week: "2026-10-05", fetchedAt: staleAt });
  const prev = process.env.EIA_BASE_URL;
  process.env.EIA_BASE_URL = "http://127.0.0.1:1";
  try {
    assert.equal((await priceFor(area, "regular"))?.priceMilli, 3650);
  } finally { process.env.EIA_BASE_URL = prev; }
});

// ---------- settings + typeahead commands ----------

test("me.updateDriving saves and clears the caller's own settings; cars keep their ids", async () => {
  const saved = await cmd("me.updateDriving", { home: HOME, cars: [{ name: "Subaru", mpg: 28, fuelGrade: "midgrade" }] }, mctx);
  const id = saved.cars[0].id;
  assert.ok(id);
  assert.deepEqual((await getDriving(memberUid)).home, HOME);
  assert.equal((await getDriving(memberUid)).cars?.[0].fuelGrade, "midgrade");
  // rename it and add a second; mpg is kept when it is not sent
  await cmd("me.updateDriving", { cars: [{ id, name: "Outback" }, { name: "Fit", mpg: 34 }] }, mctx);
  const two = await getDriving(memberUid);
  assert.deepEqual(two.cars?.map((c) => [c.id === id, c.name, c.mpg, c.fuelGrade]), [[true, "Outback", 28, "midgrade"], [false, "Fit", 34, "regular"]]);
  await cmd("me.updateDriving", { cars: [{ id, name: "Outback", mpg: null }] }, mctx);
  const after = await getDriving(memberUid);
  assert.deepEqual(after.cars?.map((c) => [c.name, c.mpg]), [["Outback", undefined]], "mpg null clears it; a car left out is removed");
  assert.deepEqual(after.home, HOME, "untouched fields stay");
  await assert.rejects(cmd("me.updateDriving", { cars: [{ id: "nope", name: "X" }] }, mctx), (e: AppError) => e.code === "invalid_input");
});

test("several cars: the estimate asks which (cars listed, missing car); carId picks one and its MPG and grade", async () => {
  const saved = await cmd("people.updateDriving", { userId: memberUid, home: HOME, cars: [{ name: "Outback", mpg: 28 }, { name: "Truck", mpg: 14, fuelGrade: "diesel" }] }, ctx);
  const [outback, truck] = saved.cars as { id: string }[];
  const ask = await cmd("expenses.estimateGas", { forId: memberUid, rehearsalId }, ctx);
  assert.deepEqual(ask.missing, ["car"]);
  assert.deepEqual(ask.cars.map((c: any) => [c.name, c.mpg]), [["Outback", 28], ["Truck", 14]]);
  assert.equal(ask.estimateCents, undefined);
  const r = await cmd("expenses.estimateGas", { forId: memberUid, rehearsalId, carId: outback.id }, ctx);
  assert.deepEqual(r.missing, []);
  assert.equal(r.carName, "Outback");
  assert.equal(r.mpg, 28);
  assert.equal(r.estimateCents, 498);
  const t = await cmd("expenses.estimateGas", { forId: memberUid, rehearsalId, carId: truck.id }, ctx);
  assert.equal(t.grade, "diesel");
  assert.equal(t.mpg, 14);
  await assert.rejects(cmd("expenses.estimateGas", { forId: memberUid, rehearsalId, carId: "nope" }, ctx), (e: AppError) => e.code === "not_found");
  // a typed MPG also answers it (no car picked)
  assert.deepEqual((await cmd("expenses.estimateGas", { forId: memberUid, rehearsalId, mpg: 30 }, ctx)).missing, []);
  // the car's name is kept on the expense; saveMpg goes onto the car that was used
  const noMpg = await cmd("people.updateDriving", { userId: memberUid, cars: [{ id: outback.id, name: "Outback", mpg: null }, { id: truck.id, name: "Truck" }] }, ctx);
  assert.equal(noMpg.cars[0].mpg, undefined);
  const est = await cmd("expenses.estimateGas", { forId: memberUid, rehearsalId, carId: outback.id, mpg: 25 }, ctx);
  const { id } = await cmd("expenses.add", { amount: est.estimateCents, what: "Gas", category: "gas", userId: memberUid, rehearsalId,
    gas: { ...gasFrom(est), carName: est.carName }, saveMpg: true, carId: outback.id }, ctx);
  assert.equal((await db.get("expenses", id))!.gas.carName, "Outback");
  assert.deepEqual((await getDriving(memberUid)).cars?.map((c) => c.mpg), [25, 14]);
});

test("driving settings are an ordinary field: history.undoRun puts them back", async () => {
  await setDriving(memberUid, { home: HOME, cars: [{ name: "Subaru", mpg: 28 }] });
  const run1 = { ...ctx, runId: newRunId() };
  await cmd("people.updateDriving", { userId: memberUid, home: LOFT, cars: [] }, run1);
  assert.equal((await getDriving(memberUid)).home?.address, LOFT.address);
  await cmd("history.undoRun", { runId: run1.runId }, { ...ctx, runId: newRunId() });
  const back = await getDriving(memberUid);
  assert.deepEqual(back.home, HOME);
  assert.deepEqual(back.cars?.map((c) => [c.name, c.mpg]), [["Subaru", 28]]);
  // a gas expense that saved an MPG: undoing that run takes both back
  const run2 = { ...ctx, runId: newRunId() };
  const est = await cmd("expenses.estimateGas", { forId: memberUid, rehearsalId, mpg: 33 }, ctx);
  const { id } = await cmd("expenses.add", { amount: est.estimateCents, what: "Gas", category: "gas", userId: memberUid, rehearsalId, gas: gasFrom(est), saveMpg: true }, run2);
  assert.equal(await mpgOf(memberUid), 33);
  await cmd("history.undoRun", { runId: run2.runId }, { ...ctx, runId: newRunId() });
  assert.equal(await mpgOf(memberUid), 28);
  assert.ok((await db.get("expenses", id))!.deletedAt, "the expense is undone too");
});

test("geo.autocomplete returns places with coordinates (and county/state for the price ladder)", async () => {
  const r = await cmd("geo.autocomplete", { q: "2363 Alder" }, mctx);
  assert.ok(r.suggestions.length > 0);
  const s = r.suggestions[0];
  assert.ok(s.address && typeof s.lat === "number" && typeof s.lng === "number");
  assert.ok(r.suggestions.some((x: any) => x.county), "at least one suggestion carries a county");
});

// ---------- the MCP connector (Claude's app) ----------

test("MCP: estimate a bandmate's gas, save their car, and log the expense in their name", async () => {
  const { callTool } = await import("../../mcp/tools");
  const tctx: Ctx = { uid: ctx.uid, role: "mcp", via: "mcp", runId: newRunId() };
  const call = async (name: string, args: unknown) => JSON.parse((await callTool(name, args, async () => tctx)).content[0].text);
  const saved = await call("people.updateDriving", { userId: memberUid, cars: [{ name: "2010 Honda Fit", mpg: 30 }] });
  assert.equal(saved.result.cars[0].mpg, 30);
  assert.equal((await getDriving(memberUid)).cars?.[0].name, "2010 Honda Fit");
  const est = (await call("expenses.estimateGas", { forId: memberUid, from: HOME, to: LOFT })).result;
  assert.deepEqual(est.missing, []);
  assert.equal(est.mpg, 30, "the only car's MPG is used");
  assert.equal(est.carName, "2010 Honda Fit");
  const { source: _s, areaKind: _a, missing: _m, homeAddress: _h, carId: _c, estimateCents, ...nums } = est;
  const add = await call("expenses.add", {
    amount: estimateCents, what: "Gas", category: "gas", userId: memberUid, date: "2026-10-29",
    gas: { ...nums, fromText: HOME.address, to: LOFT, estimateCents },
  });
  assert.ok(add.result?.id, JSON.stringify(add));
  const x = (await db.get("expenses", add.result.id))!;
  assert.equal(x.userId, memberUid);
  assert.equal(x.payBack, true);
  assert.equal(x.gas.overridden, false);
  assert.equal(x.gas.mpg, 30);
  const upd = await call("expenses.update", { id: add.result.id, patch: { amount: estimateCents + 100 } });
  assert.ok(!upd.error, JSON.stringify(upd));
  assert.equal((await db.get("expenses", add.result.id))!.gas.overridden, true);
  // A driver who covers their own gas: no pay back, and the typed addresses stay on the expense.
  const own = await call("expenses.add", {
    amount: estimateCents, what: "Gas", category: "gas", userId: memberUid, payBack: false,
    gas: { ...nums, fromKind: "typed", fromText: HOME.address, to: LOFT, estimateCents },
  });
  const o = (await db.get("expenses", own.result.id))!;
  assert.equal(o.payBack, false);
  assert.equal(o.gas.fromText, HOME.address);
  assert.equal(o.gas.to.address, LOFT.address);
  const gone = await call("people.updateDriving", { userId: "nobody", cars: [] });
  assert.equal(gone.error.code, "not_found");
});
