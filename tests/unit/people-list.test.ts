import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";

beforeEach(resetEmulators);
const bearer = (t: string) => `Bearer ${t}`;
type Person = { userId: string | null; musicianId: string | null; name: string; email: string; role: "admin" | "member" | null; mcpAccess: boolean; inBand: boolean; archived: boolean };

test("people.list: team users, linked musician, musician-only sub, archived musician", async () => {
  const mus = await db.create(importCtx(), "musicians", { name: "Linda", instruments: ["bass"], active: true });
  const admin = await makeUser("a@example.com", "admin", { name: "Ann", musicianId: mus.id });
  await db.update(importCtx(), "musicians", mus.id, { userId: admin.uid });
  const member = await makeUser("m@example.com", "member", { name: "Mo" });
  await dispatch("musicians.create", bearer(admin.token), { name: "Sub Sam", instruments: ["drums"] });
  const arch = await db.create(importCtx(), "musicians", { name: "Old Ollie", instruments: ["keys"], active: true });
  await db.update(importCtx(), "musicians", arch.id, { archivedAt: new Date().toISOString(), active: false });

  const r = await dispatch("people.list", bearer(admin.token), {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const { people } = (r.json as { result: { people: Person[] } }).result;
  const by = (n: string) => people.find((p) => p.name === n)!;
  assert.deepEqual(people.map((p) => p.name), ["Ann", "Mo", "Old Ollie", "Sub Sam"]);
  assert.deepEqual(by("Ann"), { userId: admin.uid, musicianId: mus.id, name: "Ann", email: "a@example.com", role: "admin", mcpAccess: false, inBand: true, archived: false });
  assert.deepEqual([by("Mo").userId, by("Mo").musicianId, by("Mo").role, by("Mo").inBand, by("Mo").mcpAccess], [member.uid, null, "member", false, false]);
  assert.deepEqual([by("Sub Sam").userId, by("Sub Sam").role, by("Sub Sam").inBand, by("Sub Sam").archived], [null, null, true, false]);
  assert.deepEqual([by("Old Ollie").userId, by("Old Ollie").role, by("Old Ollie").inBand, by("Old Ollie").archived], [null, null, false, true]);
  for (const p of people) assert.deepEqual(Object.keys(p).sort(), ["archived", "email", "inBand", "mcpAccess", "musicianId", "name", "role", "userId"]);
});

test("people.list: AI access shows for an admin who has it", async () => {
  const admin = await makeUser("a@example.com", "admin", { name: "Ann" });
  await db.update(importCtx(), "users", admin.uid, { artists: [{ artistId: TEST_ARTIST, role: "admin", mcpAccess: true }] });
  const r = await dispatch("people.list", bearer(admin.token), {});
  const { people } = (r.json as { result: { people: Person[] } }).result;
  assert.equal(people[0].mcpAccess, true);
});

test("people.list: a member is refused", async () => {
  const member = await makeUser("m@example.com", "member");
  const r = await dispatch("people.list", bearer(member.token), {});
  assert.equal(r.status, 403);
});
