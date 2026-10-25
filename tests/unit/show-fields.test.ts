import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { importCtx } from "@/server/ctx";
import { resetEmulators, makeUser, makeArtist, venue, TEST_ARTIST } from "./helpers";

beforeEach(resetEmulators);
const bearer = (t: string) => `Bearer ${t}`;
type Out = { json: unknown; status: number };
const result = <T = { id: string }>(r: Out) => (r.json as { result: T }).result;
const code = (r: Out) => (r.json as { error: { code: string } }).error.code;

async function world() {
  await makeArtist("Ingrid Avison Band", "ingrid-avison-band");
  const admin = await makeUser("a@example.com", "admin");
  const member = await makeUser("m@example.com", "member");
  const v = await db.create(importCtx(), "venues", venue("The Bluebird"));
  const call = (who: { token: string }, name: string, input: unknown) => dispatch(name, bearer(who.token), input, TEST_ARTIST);
  const show = async (date: string) => result(await call(admin, "shows.create", { venueId: v.id, date, addToCalendar: false })).id;
  const field = async (kind: "Show" | "Song", label: string) => result<{ fieldId: string }>(await call(admin, `artists.add${kind}Field`, { id: TEST_ARTIST, label })).fieldId;
  const artist = async () => (await db.get("artists", TEST_ARTIST))!;
  return { admin, member, call, show, field, artist };
}
const values = async (id: string) => (await db.get("shows", id))!.fields as { fieldId: string; value: string }[];

test("show fields: add, rename and reorder are admin-only and kept apart from song fields", async () => {
  const { admin, member, call, field, artist } = await world();
  assert.deepEqual((await artist()).showFields ?? [], []);
  assert.equal((await call(member, "artists.addShowField", { id: TEST_ARTIST, label: "Parking" })).status, 403);
  const parking = await field("Show", "Parking"), hotel = await field("Show", "Hotel"), capo = await field("Song", "Capo");
  assert.deepEqual((await artist()).showFields, [{ id: parking, label: "Parking" }, { id: hotel, label: "Hotel" }]);
  assert.deepEqual((await artist()).songFields, [{ id: capo, label: "Capo" }]);
  assert.equal((await call(admin, "artists.addShowField", { id: TEST_ARTIST, label: "  " })).status, 400);

  assert.equal((await call(admin, "artists.updateShowField", { id: TEST_ARTIST, fieldId: hotel, label: "Lodging" })).status, 200);
  assert.equal(((await artist()).showFields as { label: string }[])[1].label, "Lodging");
  // a song field's id is not a show field
  assert.equal((await call(admin, "artists.updateShowField", { id: TEST_ARTIST, fieldId: capo, label: "X" })).status, 404);

  assert.equal((await call(admin, "artists.reorderShowFields", { id: TEST_ARTIST, fieldIds: [hotel, parking] })).status, 200);
  assert.deepEqual(((await artist()).showFields as { id: string }[]).map((f) => f.id), [hotel, parking]);
  assert.equal((await call(admin, "artists.reorderShowFields", { id: TEST_ARTIST, fieldIds: [hotel] })).status, 409);

  // artists.update can't touch the definitions
  assert.equal((await call(admin, "artists.update", { id: TEST_ARTIST, patch: { showFields: [] } })).status, 400);
});

test("shows.setFields: admin-only, trims, drops blanks, refuses unknown or repeated fields", async () => {
  const { admin, member, call, show, field } = await world();
  const parking = await field("Show", "Parking"), hotel = await field("Show", "Hotel");
  const s = await show("2027-05-01");
  assert.deepEqual(await values(s), [], "a new show has no values");

  assert.equal((await call(member, "shows.setFields", { id: s, fields: [{ fieldId: parking, value: "Lot B" }] })).status, 403);
  assert.equal((await call(admin, "shows.setFields", { id: s, fields: [{ fieldId: parking, value: "  Lot B " }, { fieldId: hotel, value: "   " }] })).status, 200);
  assert.deepEqual(await values(s), [{ fieldId: parking, value: "Lot B" }], "trimmed; blank means no entry");

  const bad = await call(admin, "shows.setFields", { id: s, fields: [{ fieldId: "nope", value: "x" }] });
  assert.equal(bad.status, 400);
  assert.equal(code(bad), "invalid_input");
  assert.equal((await call(admin, "shows.setFields", { id: s, fields: [{ fieldId: parking, value: "a" }, { fieldId: parking, value: "b" }] })).status, 400);
  assert.deepEqual(await values(s), [{ fieldId: parking, value: "Lot B" }], "refused calls change nothing");

  // the whole list is replaced: leaving a field out clears it
  await call(admin, "shows.setFields", { id: s, fields: [{ fieldId: hotel, value: "Marriott" }] });
  assert.deepEqual(await values(s), [{ fieldId: hotel, value: "Marriott" }]);
});

test("artists.removeShowField strips the field from every show, keeps the others and leaves songs alone", async () => {
  const { admin, call, show, field, artist } = await world();
  const parking = await field("Show", "Parking"), hotel = await field("Show", "Hotel"), capo = await field("Song", "Capo");
  const a = await show("2027-05-01"), b = await show("2027-05-02"), c = await show("2027-05-03");
  await call(admin, "shows.setFields", { id: a, fields: [{ fieldId: parking, value: "Lot B" }, { fieldId: hotel, value: "Marriott" }] });
  await call(admin, "shows.setFields", { id: b, fields: [{ fieldId: parking, value: "Street" }] });
  await call(admin, "shows.setFields", { id: c, fields: [{ fieldId: hotel, value: "Motel 6" }] });
  const song = await db.create(importCtx(), "songs", { title: "Angel", fields: [{ fieldId: capo, value: "3" }] });

  const r = await call(admin, "artists.removeShowField", { id: TEST_ARTIST, fieldId: parking });
  assert.equal(r.status, 200);
  assert.equal(result<{ showsCleared: number }>(r).showsCleared, 2);
  assert.deepEqual(await values(a), [{ fieldId: hotel, value: "Marriott" }]);
  assert.deepEqual(await values(b), []);
  assert.deepEqual(await values(c), [{ fieldId: hotel, value: "Motel 6" }]);
  assert.deepEqual(((await artist()).showFields as { id: string }[]).map((f) => f.id), [hotel]);
  assert.deepEqual((await db.get("songs", song.id))!.fields, [{ fieldId: capo, value: "3" }]);
  // the removed field can no longer be set
  assert.equal((await call(admin, "shows.setFields", { id: a, fields: [{ fieldId: parking, value: "x" }] })).status, 400);
  assert.equal((await call(admin, "artists.removeShowField", { id: TEST_ARTIST, fieldId: parking })).status, 404);

  // and removing a song field leaves show values alone
  await call(admin, "artists.removeSongField", { id: TEST_ARTIST, fieldId: capo });
  assert.deepEqual(await values(a), [{ fieldId: hotel, value: "Marriott" }]);
});
