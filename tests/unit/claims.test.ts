import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAIMS_MAX_BYTES, TOO_MANY_ARTISTS, assertClaimsFit, claimsBytes, claimsFor } from "@/server/session";

// Tenancy phase 2: the sign-in token carries {artists, adminOf, musicians}; Firebase caps claims at 1000 bytes, Roadie at 900.

const ms = (n: number) => Array.from({ length: n }, (_, i) => ({ artistId: `artist${String(i).padStart(14, "0")}`, role: i % 2 ? "member" : "admin", musicianId: `musician${String(i).padStart(12, "0")}` }));

test("claimsFor: roles, the artists they're admin of, and their musician in each (ai memberships stay out)", () => {
  const user = { musicianId: "m1", artists: [{ artistId: "a", role: "admin", musicianId: "m1" }, { artistId: "b", role: "member" }, { artistId: "c", role: "ai" }] };
  assert.deepEqual(claimsFor(user), { artists: { a: "admin", b: "member" }, adminOf: ["a"], musicians: { a: "m1" }, musicianId: "m1" });
});

test("about eight artists fit; more are refused before anything is written", () => {
  assert.doesNotThrow(() => assertClaimsFit({ artists: ms(7) }));
  const many = { artists: ms(12) };
  assert.ok(claimsBytes(claimsFor(many)) > CLAIMS_MAX_BYTES);
  assert.throws(() => assertClaimsFit(many), (e: Error & { code?: string }) => e.code === "too_many_artists" && e.message === TOO_MANY_ARTISTS);
});
