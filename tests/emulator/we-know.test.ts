import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";

// Networking (#82 S10): "We know them" is a band-private flag (weKnow) on contactNotes and actNotes, never on the shared record.
let ctx: Ctx;
const cmd = async (name: string, input: unknown) => {
  const x = registry[name];
  return (await x.run(ctx, x.input.parse(input))) as Record<string, any>;
};
const noteId = (id: string) => `${TEST_ARTIST}__${id}`;

beforeEach(async () => {
  await resetEmulators();
  const u = await makeUser("rudy@example.com", "admin");
  ctx = { uid: u.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
});

test("contacts.update weKnow sets the flag on the band's contactNote and false clears it; the contact doc never gets it", async () => {
  const c = await cmd("contacts.create", { name: "Kate Booker", emails: ["kate@example.com"] });
  await cmd("contacts.update", { id: c.id, patch: { weKnow: true } });
  assert.equal((await db.get("contactNotes", noteId(c.id)))?.weKnow, true);
  assert.equal((await db.get("contacts", c.id))?.weKnow, undefined);
  await cmd("contacts.update", { id: c.id, patch: { weKnow: false } });
  assert.ok(!(await db.get("contactNotes", noteId(c.id)))?.weKnow);
});

test("contacts.create accepts weKnow", async () => {
  const c = await cmd("contacts.create", { name: "Sam Friend", weKnow: true });
  assert.equal((await db.get("contactNotes", noteId(c.id)))?.weKnow, true);
});

test("acts.update weKnow sets the flag on the band's actNote, next to the shortlist, and false clears it", async () => {
  const a = await cmd("acts.create", { name: "The Haystack Ramblers", shortlist: true });
  await cmd("acts.update", { id: a.id, patch: { weKnow: true } });
  let n = await db.get("actNotes", noteId(a.id));
  assert.equal(n?.weKnow, true);
  assert.equal(n?.shortlist, true);
  assert.equal((await db.get("acts", a.id))?.weKnow, undefined);
  await cmd("acts.update", { id: a.id, patch: { weKnow: false } });
  n = await db.get("actNotes", noteId(a.id));
  assert.ok(!n?.weKnow);
  assert.equal(n?.shortlist, true);
});
