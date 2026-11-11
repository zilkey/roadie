// Fan list pure helpers: city merging and parsing, fan ids, signup body validation (no emulator).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SignupBody, fanId } from "@/server/fans";
import { groupOf, haversineMiles, mergeCities, parseCity } from "@/lib/fans";

test("pure: cities merge case-insensitively, the latest moves last, groups are City, ST", () => {
  const m = mergeCities([{ city: "Denver", state: "CO", lat: 1, lng: 2 }, { city: "Boise", state: "ID" }], [{ city: "denver" }, { city: "Salt Lake City", state: "UT" }]);
  assert.deepEqual(m.map((c) => c.city), ["Boise", "Denver", "Salt Lake City"]);
  assert.deepEqual(m[1], { city: "Denver", state: "CO", lat: 1, lng: 2 });
  assert.equal(groupOf(m), "Salt Lake City, UT");
  assert.equal(groupOf([]), "No city");
  assert.equal(groupOf([{ city: "Moab" }]), "Moab");
  assert.ok(Math.abs(haversineMiles({ lat: 39.74, lng: -104.99 }, { lat: 40.015, lng: -105.27 }) - 25) < 4);
});

test("fanId is stable per artist and lowercased email", () => {
  assert.equal(fanId("a", "Fan@Example.com"), fanId("a", "fan@example.com"));
  assert.notEqual(fanId("a", "fan@example.com"), fanId("b", "fan@example.com"));
});

test("signup: validation is server-side", async () => {
  assert.equal(SignupBody.safeParse({ email: "nope", page: "/f/x" }).success, false);
  assert.equal(SignupBody.safeParse({ email: "a@b.co" }).success, false, "page is required");
  assert.equal(SignupBody.safeParse({ email: "a@b.co", page: "/f/x", extra: 1 }).success, false);
  assert.equal(SignupBody.parse({ email: "  Fan@Example.COM ", page: "/f/x" }).email, "fan@example.com");
});

test("parseCity title-cases an all-lowercase city, leaves mixed case alone, and uppercases the state", () => {
  assert.deepEqual(parseCity("denver, co"), { city: "Denver", state: "CO" });
  assert.deepEqual(parseCity("salt lake city"), { city: "Salt Lake City" });
  assert.deepEqual(parseCity("McCall, id"), { city: "McCall", state: "ID" });
});
