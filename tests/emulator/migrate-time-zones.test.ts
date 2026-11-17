/** Tenancy phase 8: scripts/migrate-time-zones.ts gives artists without a time zone America/Denver, and only those. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { db } from "@/server/db";
import { migrateTimeZones } from "../../scripts/migrate-time-zones";
import { SYS, makeArtist, resetEmulators } from "./helpers";

before(async () => {
  await resetEmulators();
  await makeArtist("Denver Band", "denver-band", "den");
  await makeArtist("New York Band", "new-york-band", "nyc", "America/New_York");
  // An artist from before phase 8: no zone at all.
  await firestore().doc("artists/den").update({ timeZone: FieldValue.delete() });
});

test("a dry run lists the artist without a zone and changes nothing", async () => {
  const r = await migrateTimeZones({ apply: false });
  assert.deepEqual(r.missing.map((a) => a.id), ["den"]);
  assert.equal(r.total, 2);
  assert.equal((await db.get(SYS, "artists", "den"))!.timeZone, undefined);
});

test("--apply sets America/Denver through the Writer; New York keeps its own; a second dry run reports 0", async () => {
  const r = await migrateTimeZones({ apply: true });
  assert.equal(r.missing.length, 1);
  const den = (await db.get(SYS, "artists", "den"))!;
  assert.equal(den.timeZone, "America/Denver");
  assert.equal(den.updatedBy, "migrate-time-zones");
  assert.equal((await db.get(SYS, "artists", "nyc"))!.timeZone, "America/New_York");
  assert.equal((await migrateTimeZones({ apply: false })).missing.length, 0);
});

test("refuses a zone that isn't one", async () => {
  await assert.rejects(migrateTimeZones({ apply: false, zone: "Mars/Olympus" }), /Not a time zone/);
});
