/**
 * Acceptance tests for the gas estimate: the math, the EIA price-area ladder, estimateGas's missing-info answers
 * (never a throw, never an address), the save flags writing only the caller's settings, and the fuelPrices cache
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
import { gasCents, tripMiles } from "@/server/gas/math";
import { areaFor, priceFor, productFor } from "@/server/gas/price";
import { getDriving, updateDriving } from "@/server/driving";
import { resetEmulators, makeUser } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx, mctx: Ctx;
let memberUid: string;
let rehearsalId: string;

// What the fakes return, fixed so every number here and in e2e is deterministic (see fakes/fake-ors and fakes/fake-eia):
// directions: 18.4 mi one way (29611.93 m); EIA: $3.790/gal regular, week 2026-10-19, for every area.
const HOME = { address: "742 Evergreen Terrace, Denver, CO, USA", lat: 39.7005, lng: -104.9503 };
const LOFT = { name: "The Loft", address: "2363 Champa St, Denver, CO, USA", lat: 39.7526, lng: -104.9868 };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  for (const [name, env] of [["fake-ors", "ORS_BASE_URL"], ["fake-eia", "EIA_BASE_URL"], ["fake-drive", "DRIVE_BASE_URL"]] as const) {
    if (s.running[name]) process.env[env] = s.running[name].url;
  }
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};

beforeEach(async () => {
  await resetEmulators();
  const a = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId() };
  const m = await makeUser("david@example.com", "member", { name: "David" });
  memberUid = m.uid;
  mctx = { uid: m.uid, role: "member", via: "app", runId: newRunId() };
  rehearsalId = (await db.create(ctx, "rehearsals", { date: "2026-10-29", location: LOFT, personnel: [], songs: [] })).id;
});

// ---------- pure ----------

test("math: the three spec rows, exactly", () => {
  assert.equal(gasCents(tripMiles(18.4, true), 28, 3790), 498);
  assert.equal(gasCents(tripMiles(18.4, false), 28, 3790), 249);
  assert.equal(gasCents(tripMiles(11.05, true), 34, 3790), 246);
});

test("price area ladder: county → metro → state → PADD → U.S.", () => {
  const denver = areaFor("Denver County", "CO");
  assert.equal(denver.areaKind, "metro");
  assert.equal(denver.area, "Denver");
  const mesa = areaFor("Mesa County", "CO");
  assert.equal(mesa.areaKind, "state");
  assert.equal(mesa.area, "Colorado");
  const ada = areaFor("Ada County", "ID");
  assert.equal(ada.areaKind, "padd");
  assert.match(ada.area, /PADD 4/);
  const none = areaFor(undefined, undefined);
  assert.equal(none.areaKind, "us");
  assert.equal(none.area, "U.S.");
  for (const a of [denver, mesa, ada, none]) assert.ok(a.duoarea, `${a.area} has a duoarea facet code`);
  assert.ok(productFor("regular"));
});

// ---------- estimateGas ----------

test("estimateGas: full info gives the frozen numbers; home never leaves the server", async () => {
  await updateDriving(memberUid, { home: HOME, mpg: 28, carName: "Subaru", fuelGrade: "regular" });
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
  assert.ok(!JSON.stringify(r).includes("Evergreen"), "the home address never appears in the reply");
  const oneWay = await cmd("expenses.estimateGas", { rehearsalId, roundTrip: false }, mctx);
  assert.equal(oneWay.estimateCents, 249);
});

test("estimateGas: missing info comes back named, one gap at a time, and never throws", async () => {
  // no MPG: everything else present
  await updateDriving(memberUid, { home: HOME });
  const noMpg = await cmd("expenses.estimateGas", { rehearsalId }, mctx);
  assert.deepEqual(noMpg.missing, ["mpg"]);
  assert.ok(Math.abs(noMpg.oneWayMiles - 18.4) < 0.01, "distance still comes back");
  assert.equal(noMpg.estimateCents, undefined);
  // typed mpg fills the gap without saving anything
  const typedMpg = await cmd("expenses.estimateGas", { rehearsalId, mpg: 28 }, mctx);
  assert.deepEqual(typedMpg.missing, []);
  assert.equal(typedMpg.estimateCents, 498);
  assert.equal((await getDriving(memberUid))?.mpg, undefined);
  // no home: mpg saved, no from
  await updateDriving(memberUid, { home: null, mpg: 28 });
  const noHome = await cmd("expenses.estimateGas", { rehearsalId }, mctx);
  assert.deepEqual(noHome.missing, ["home"]);
  // a typed From fills it
  const typedFrom = await cmd("expenses.estimateGas", { rehearsalId, from: { address: HOME.address, lat: HOME.lat, lng: HOME.lng } }, mctx);
  assert.deepEqual(typedFrom.missing, []);
  assert.equal(typedFrom.fromKind, "typed");
  // no destination: home and mpg saved, no rehearsal location and no `to`
  await updateDriving(memberUid, { home: HOME, mpg: 28 });
  const bare = (await db.create(ctx, "rehearsals", { date: "2026-11-05", personnel: [], songs: [] })).id;
  const noDest = await cmd("expenses.estimateGas", { rehearsalId: bare }, mctx);
  assert.deepEqual(noDest.missing, ["destination"]);
  const noDest2 = await cmd("expenses.estimateGas", {}, mctx);
  assert.deepEqual(noDest2.missing, ["destination"]);
});

test("estimateGas for a bandmate: admins only, uses their settings, returns miles and never an address", async () => {
  await updateDriving(memberUid, { home: HOME, mpg: 28 });
  const r = await cmd("expenses.estimateGas", { forId: memberUid, rehearsalId }, ctx);
  assert.deepEqual(r.missing, []);
  assert.equal(r.fromKind, "home");
  assert.equal(r.mpg, 28);
  assert.equal(r.estimateCents, 498);
  assert.ok(!JSON.stringify(r).includes("Evergreen"), "David's address never reaches the admin");
  await assert.rejects(cmd("expenses.estimateGas", { forId: ctx.uid, rehearsalId }, mctx), (e: AppError) => e.code === "forbidden");
  // the bandmate's gaps are asked for the same way (admin enters them for this expense only)
  await updateDriving(memberUid, { mpg: null });
  const gap = await cmd("expenses.estimateGas", { forId: memberUid, rehearsalId }, ctx);
  assert.deepEqual(gap.missing, ["mpg"]);
});

// ---------- the saved expense ----------

const gasFrom = (r: Record<string, any>) => ({
  fromKind: r.fromKind, to: LOFT, oneWayMiles: r.oneWayMiles, roundTrip: r.roundTrip, miles: r.miles,
  mpg: r.mpg, grade: r.grade, priceMilli: r.priceMilli, priceArea: r.priceArea, priceWeek: r.priceWeek, seriesId: r.seriesId, estimateCents: r.estimateCents,
});

test("a gas expense from a home trip stores miles and fromKind home, never an address; overridden follows the amount", async () => {
  await updateDriving(memberUid, { home: HOME, mpg: 28 });
  const est = await cmd("expenses.estimateGas", { rehearsalId }, mctx);
  const { id } = await cmd("expenses.add", { amount: est.estimateCents, what: "Gas", category: "travel", rehearsalId, gas: gasFrom(est) }, mctx);
  const x = (await db.get("expenses", id)) as any;
  assert.equal(x.rehearsalId, rehearsalId);
  assert.equal(x.gas.fromKind, "home");
  assert.equal(x.gas.fromText, undefined);
  assert.ok(!JSON.stringify(x.gas).includes("Evergreen"), "no home address on the expense");
  assert.equal(x.gas.overridden, false);
  assert.equal(x.gas.estimateCents, 498);
  // typing a different amount up front marks it overridden but keeps the estimate
  const { id: id2 } = await cmd("expenses.add", { amount: 600, what: "Gas", category: "travel", rehearsalId, gas: gasFrom(est) }, mctx);
  const y = (await db.get("expenses", id2)) as any;
  assert.equal(y.gas.overridden, true);
  assert.equal(y.gas.estimateCents, 498);
  assert.equal(y.amount, 600);
});

test("the save flags write the payer's settings: the driver an admin logs for, else the caller", async () => {
  await updateDriving(ctx.uid, { mpg: 22 });
  await updateDriving(memberUid, { home: HOME, mpg: null });
  const est = await cmd("expenses.estimateGas", { forId: memberUid, rehearsalId, mpg: 31 }, ctx);
  await cmd("expenses.add", { amount: est.estimateCents, what: "Gas", category: "gas", userId: memberUid, rehearsalId, gas: gasFrom(est), saveMpg: true }, ctx);
  assert.equal((await getDriving(ctx.uid))?.mpg, 22, "the admin's own MPG is untouched");
  const d = await getDriving(memberUid);
  assert.equal(d?.mpg, 31, "the driver's settings took the MPG");
  assert.deepEqual(d?.home, HOME);
  // saveAsHome writes the member's own home when they typed their From
  await updateDriving(memberUid, { home: null });
  const typed = await cmd("expenses.estimateGas", { rehearsalId, from: { address: HOME.address, lat: HOME.lat, lng: HOME.lng } }, mctx);
  await cmd("expenses.add", {
    amount: typed.estimateCents, what: "Gas", category: "travel", rehearsalId,
    gas: { ...gasFrom(typed), fromText: HOME.address }, saveAsHome: HOME,
  }, mctx);
  assert.deepEqual((await getDriving(memberUid))?.home, HOME);
});

test("setAsRehearsalLocation (admins): the typed To becomes the rehearsal's location", async () => {
  await updateDriving(ctx.uid, { home: HOME, mpg: 28 });
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

test("me.updateDriving saves and clears the caller's own settings", async () => {
  const saved = await cmd("me.updateDriving", { home: HOME, carName: "Subaru", mpg: 28, fuelGrade: "midgrade" }, mctx);
  assert.equal(saved.mpg, 28);
  assert.deepEqual((await getDriving(memberUid))?.home, HOME);
  assert.equal((await getDriving(memberUid))?.fuelGrade, "midgrade");
  await cmd("me.updateDriving", { carName: null, mpg: null }, mctx);
  const after = await getDriving(memberUid);
  assert.equal(after?.carName, undefined);
  assert.equal(after?.mpg, undefined);
  assert.deepEqual(after?.home, HOME, "untouched fields stay");
});

test("geo.autocomplete returns places with coordinates (and county/state for the price ladder)", async () => {
  const r = await cmd("geo.autocomplete", { q: "2363 Champa" }, mctx);
  assert.ok(r.suggestions.length > 0);
  const s = r.suggestions[0];
  assert.ok(s.address && typeof s.lat === "number" && typeof s.lng === "number");
  assert.ok(r.suggestions.some((x: any) => x.county), "at least one suggestion carries a county");
});
