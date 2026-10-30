import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";
import { QUIET_DAYS, quietDays, todayStr } from "@/lib/booking";
import { addDays } from "@/lib/pickShow";

let sys: Ctx;
let pitchId: string;

before(() => { process.env.TZ = "UTC"; });
beforeEach(async () => {
  await resetEmulators();
  const admin = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  sys = { uid: admin.uid, role: "admin", via: "app", runId: newRunId() };
  await db.create(importCtx(), "artists", { slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
  const v = (await call("venues.create", venue("Hi-Dive"))) as { id: string };
  pitchId = ((await call("pitches.flag", { kind: "venue", id: v.id })) as { id: string }).id;
});

const call = (name: string, input: unknown) => registry[name].run(sys, registry[name].input.parse(input));
const lastContact = async () => (await db.get("pitches", pitchId))?.lastContactAt;

test("moving to pitched sets lastContactAt", async () => {
  assert.equal(await lastContact(), undefined);
  await call("pitches.move", { id: pitchId, status: "pitched" });
  assert.ok(await lastContact());
});

test("moving to declined does not set lastContactAt", async () => {
  await call("pitches.move", { id: pitchId, status: "declined" });
  assert.equal(await lastContact(), undefined);
});

for (const type of ["call", "email", "visit"] as const) {
  test(`logging a ${type} sets lastContactAt`, async () => {
    await call("pitches.log", { id: pitchId, type, text: "hi" });
    assert.ok(await lastContact());
  });
}

test("logging a note does not set lastContactAt", async () => {
  await call("pitches.log", { id: pitchId, type: "note", text: "hi" });
  assert.equal(await lastContact(), undefined);
});

test("a pitch just moved to pitched is not flagged as quiet", async () => {
  await call("pitches.move", { id: pitchId, status: "pitched" });
  const r = (await call("pitches.needingFollowUp", { quietDays: 1 })) as { pitches: { id: string; daysSinceContact: number | null }[] };
  assert.equal(r.pitches.find((p) => p.id === pitchId), undefined);
});

// ---------- going quiet: Pitched or Talking, two weeks after the last contact ----------

test("quietDays counts band-timezone calendar days, only for Pitched and Talking", () => {
  const oct12Night = Date.parse("2026-10-13T05:30:00Z"); // 11:30pm Oct 12 in Denver
  assert.equal(quietDays("pitched", oct12Night, "2026-10-26"), 14);
  assert.equal(quietDays("talking", oct12Night, "2026-10-25"), 13);
  for (const s of ["idea", "toPitch", "booked", "declined", "dropped"]) assert.equal(quietDays(s, oct12Night, "2026-10-26"), undefined);
  assert.equal(quietDays("pitched", undefined, "2026-10-26"), undefined);
  assert.equal(QUIET_DAYS, 14);
});

test("needingFollowUp: Pitched and Talking quiet for 14 days, To Pitch never", async () => {
  const other = ((await call("pitches.flag", { kind: "venue", id: ((await call("venues.create", venue("Fox"))) as { id: string }).id })) as { id: string }).id;
  const third = ((await call("pitches.flag", { kind: "venue", id: ((await call("venues.create", venue("Lost Lake"))) as { id: string }).id })) as { id: string }).id;
  await call("pitches.move", { id: pitchId, status: "pitched" });
  await call("pitches.move", { id: other, status: "talking" });
  // Calendar days from the band-timezone today: a UTC date is a day ahead on Denver evenings.
  const today = (days: number) => addDays(todayStr(), days);
  const quiet = async (days: number) => ((await call("pitches.needingFollowUp", { today: today(days) })) as { pitches: { id: string; reasons: string[] }[] })
    .pitches.filter((p) => p.reasons.some((r) => r.startsWith("No contact"))).map((p) => p.id).sort();
  assert.deepEqual(await quiet(13), []);
  assert.deepEqual(await quiet(14), [pitchId, other].sort());
  assert.ok(!(await quiet(30)).includes(third), "To Pitch never goes quiet");
});
