import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { festivalRows } from "@/lib/festivalPage";
import { resetEmulators, makeUser, venue } from "./helpers";

let ctx: Ctx;

beforeEach(async () => {
  await resetEmulators();
  const u = await makeUser("jeff@example.com", "admin", { name: "Jeff Smith" });
  ctx = { uid: u.uid, role: "admin", via: "app", runId: newRunId() };
});

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};
const fails = (p: Promise<unknown>, status: number, re: RegExp) => assert.rejects(p, (e: any) => e.status === status && re.test(e.message));

test("venue types: the built-ins come first, Other adds one for everyone, the same name twice is one type", async () => {
  const winery = await cmd("venueTypes.add", { label: "Winery" });
  assert.equal(winery.id, "winery");
  const live = (await db.list("venueTypes")).map((t) => t.id).sort();
  assert.deepEqual(live, ["bar", "brewery", "club", "house", "listening", "outdoor", "theater", "winery"]);
  assert.deepEqual(await cmd("venueTypes.add", { label: " winery " }), { id: "winery", existing: true });
  // "Listening Room" is the built-in "listening" (its label), not a new key.
  assert.deepEqual(await cmd("venueTypes.add", { label: "Listening Room" }), { id: "listening", existing: true });
  // A member who can add a venue can add its type.
  assert.equal((await cmd("venueTypes.add", { label: "Coffee shop" }, { ...ctx, role: "member" })).id, "coffee-shop");
});

test("a venue's type must be on the list (its own old type is kept)", async () => {
  await fails(cmd("venues.create", venue("Rocket Room", "Denver", { type: "spaceship" })), 400, /"spaceship" is not a venue type/);
  const id = (await db.create(ctx, "venues", venue("Old Room", "Denver", { type: "other" }))).id; // typed before the list could grow
  await cmd("venues.update", { id, patch: { type: "other", capacity: 80 } });
  await fails(cmd("venues.update", { id, patch: { type: "spaceship" } }), 400, /not a venue type/);
});

test("venue types: rename keeps the key (its venues keep it); remove is refused while a venue has it", async () => {
  await cmd("venueTypes.add", { label: "Winery" });
  const v = await cmd("venues.create", venue("Ten Bears", "Laporte", { type: "winery" }));
  await cmd("venueTypes.rename", { id: "winery", label: "Winery / vineyard" });
  assert.equal((await db.get("venueTypes", "winery"))!.label, "Winery / vineyard");
  assert.equal((await db.get("venues", v.id))!.type, "winery");
  await fails(cmd("venueTypes.rename", { id: "winery", label: "brewery" }), 409, /already a type called Brewery/);

  await fails(cmd("venueTypes.remove", { id: "winery" }), 409, /1 venue has this type/);
  await cmd("venues.update", { id: v.id, patch: { type: "bar" } });
  await cmd("venueTypes.remove", { id: "winery" });
  assert.equal((await db.list("venueTypes")).some((t) => t.id === "winery"), false);
  // Adding it again brings the same key back.
  assert.equal((await cmd("venueTypes.add", { label: "Winery" })).id, "winery");
  assert.equal((await db.get("venueTypes", "winery"))!.deletedAt, null);
});

test("festivals: create needs a town; giving an old festival its town drops the region it still had", async () => {
  await assert.throws(() => registry["festivals.create"].input.parse({ name: "No town", type: "festival" }));
  const id = (await db.create(ctx, "festivals", { name: "Old", type: "festival", region: "north", contactIds: [] })).id;
  await cmd("festivals.update", { id, patch: { address: { city: "Greeley", state: "CO" } } });
  const f = (await db.get("festivals", id))!;
  assert.deepEqual(f.address, { city: "Greeley", state: "CO" });
  assert.equal("region" in f, false);
});

test("festivals.page: one row per edition, sorted and paged on the server; rows without a date go last both ways", async () => {
  const fest = async (name: string, contactIds: string[] = []) => (await db.create(ctx, "festivals", { name, type: "festival", address: { city: "Denver", state: "CO" }, contactIds })).id;
  const ed = (festivalId: string, festivalName: string, year: number, extra: Record<string, unknown> = {}) =>
    db.create(ctx, "editions", { festivalId, festivalName, year, label: String(year), venueIds: [], ...extra });
  const priya = (await db.create(ctx, "contacts", { name: "Priya Shah", emails: ["priya@ums.example"], phones: [] })).id;
  const ums = await fest("UMS", [priya]), levitt = await fest("Levitt"), folks = await fest("Folks");
  const zed = await fest("Zed Fest"); // no edition: a row of its own
  const ums27 = (await ed(ums, "UMS", 2027, { appDeadline: { date: "2027-01-15", sure: "target" }, startDate: "2027-07-23" })).id;
  const ums26 = (await ed(ums, "UMS", 2026, { appDeadline: { date: "2026-01-15", sure: "confirmed" }, startDate: "2026-07-24" })).id;
  const lev = (await ed(levitt, "Levitt", 2027, { appDeadline: { date: "2027-02-28", sure: "confirmed" } })).id;
  const fol = (await ed(folks, "Folks", 2027, { startDate: "2027-08-20" })).id;
  const ids = (r: Record<string, any>) => r.rows.map((x: { id: string }) => x.id);

  assert.deepEqual(ids(await cmd("festivals.page", { sort: "name" })), [fol, lev, ums27, ums26, zed]);
  assert.deepEqual(ids(await cmd("festivals.page", { sort: "deadline" })).slice(0, 3), [ums26, ums27, lev]);
  assert.deepEqual(ids(await cmd("festivals.page", { sort: "-deadline" })).slice(0, 4), [lev, ums27, ums26, fol]); // Folks has no deadline: after, by name
  assert.deepEqual(ids(await cmd("festivals.page", { sort: "-date" })).slice(0, 3), [fol, ums27, ums26]);

  const p1 = await cmd("festivals.page", { sort: "deadline", limit: 2 });
  assert.equal(p1.total, 5); assert.equal(p1.nextOffset, 2);
  const p3 = await cmd("festivals.page", { sort: "deadline", limit: 2, offset: 4 });
  assert.equal(p3.rows.length, 1); assert.equal(p3.nextOffset, null);

  // The search runs on the server too: a contact's name finds the festival (both its years).
  assert.deepEqual(ids(await cmd("festivals.page", { q: "priya", sort: "deadline" })), [ums26, ums27]);
});

test("festivalRows: by name keeps each festival's newest year first", () => {
  const rows = festivalRows({
    festivals: [{ id: "b", name: "Beta" }, { id: "a", name: "Alpha" }],
    editions: [{ id: "a1", festivalId: "a", year: 2026 }, { id: "a2", festivalId: "a", year: 2027 }],
    contacts: [],
  }, "", "name");
  assert.deepEqual(rows, [{ kind: "edition", id: "a2" }, { kind: "edition", id: "a1" }, { kind: "festival", id: "b" }]);
});
