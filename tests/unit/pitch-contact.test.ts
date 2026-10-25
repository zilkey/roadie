import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

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
