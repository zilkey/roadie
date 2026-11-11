/** Gas estimate: the math and the EIA price-area ladder, with no database. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gasCents, tripMiles } from "@/server/gas/math";
import { areaFor, productFor } from "@/server/gas/price";

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
