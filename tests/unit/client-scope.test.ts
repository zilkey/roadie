import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePath, scopeQuery, scopedDocPath } from "@/lib/client-scope";

// Tenancy plan D5: what the browser's hooks ask Firestore for.

test("an artist kind is asked for in the open artist only", () => {
  assert.deepEqual(scopeQuery("shows", {}, "A"), { kind: "shows", path: "shows", where: [["artistId", "==", "A"]] });
  assert.deepEqual(scopeQuery("expenses", { where: [["userId", "==", "u1"]] }, "A")?.where, [["artistId", "==", "A"], ["userId", "==", "u1"]]);
});

test("a caller's own artistId filter is replaced by the open artist's, never doubled", () => {
  assert.deepEqual(scopeQuery("tours", { where: [["artistId", "==", "A"]] }, "A")?.where, [["artistId", "==", "A"]]);
  assert.deepEqual(scopeQuery("tours", { where: [["artistId", "==", "B"], ["status", "==", "live"]] }, "A")?.where, [["artistId", "==", "A"], ["status", "==", "live"]]);
});

test("with no artist open, an artist kind or a users list isn't asked for", () => {
  assert.equal(scopeQuery("shows", {}, undefined), null);
  assert.equal(scopeQuery("users", {}, null), null);
  assert.equal(scopedDocPath("shows", undefined), null);
});

test("a users list asks for this artist's people", () => {
  assert.deepEqual(scopeQuery("users", {}, "A"), { kind: "users", path: "users", where: [["artistIds", "array-contains", "A"]] });
});

test("shared, personal and history kinds are left as asked", () => {
  assert.deepEqual(scopeQuery("venues", { where: [["city", "==", "Denver"]] }, "A"), { kind: "venues", path: "venues", where: [["city", "==", "Denver"]] });
  assert.deepEqual(scopeQuery("venueEvents", {}, undefined), { kind: "venueEvents", path: "venueEvents", where: [] });
  const h = scopeQuery("history", { group: true, where: [["artistId", "==", null], ["shared", "==", true]] }, "A");
  assert.deepEqual(h, { kind: "history", path: "history", where: [["artistId", "==", null], ["shared", "==", true]] });
});

test("sub-collections keep their parent, built by pathOf", () => {
  assert.deepEqual(parsePath("tours/t1/entries"), { kind: "entries", parent: { kind: "tours", id: "t1" } });
  assert.deepEqual(scopeQuery("tours/t1/entries", { where: [["visibility", "==", "band"]] }, "A"),
    { kind: "entries", path: "tours/t1/entries", where: [["artistId", "==", "A"], ["visibility", "==", "band"]] });
  assert.throws(() => scopeQuery("shows/s1/entries", {}, "A"), /doesn't live under/);
  assert.equal(scopedDocPath("pitches/p1/comments", "A"), "pitches/p1/comments");
});

test("a collection group is asked for by its kind", () => {
  assert.deepEqual(scopeQuery("tracks", { group: true, where: [["songId", "==", "s1"]] }, "A"),
    { kind: "tracks", path: "tracks", where: [["artistId", "==", "A"], ["songId", "==", "s1"]] });
});

test("a kind with no owner is refused", () => {
  assert.throws(() => scopeQuery("nope", {}, "A"), /No owner/);
  assert.throws(() => parsePath("a/b"), /Not a collection path/);
});
