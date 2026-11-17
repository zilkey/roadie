import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { OWNERS, ownerOf, pathOf } from "@/schema/owners";
import { collections } from "@/schema";
import { SERVER_KEPT } from "@/server/backup";
import { SHARED_KINDS } from "@/server/platform";

// The owner table (tenancy plan D1) must name every kind there is: a kind with no owner can't be scoped to an artist.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" ? [] : files(p);
    return /\.(ts|tsx|mts)$/.test(f) ? [p] : [];
  });
}
const missing = (kinds: Iterable<string>) => [...new Set(kinds)].filter((k) => !ownerOf(k)).sort();

test("every kind in collections has an owner", () => {
  assert.deepEqual(missing(Object.keys(collections)), []);
});

test("every server-kept collection has an owner", () => {
  assert.deepEqual(missing(SERVER_KEPT), []);
});

test("every collection firestore.rules matches has an owner", () => {
  const rules = readFileSync("firestore.rules", "utf8");
  const kinds = [...rules.matchAll(/match \/([A-Za-z]+)\//g)].map((m) => m[1]).filter((k) => k !== "databases");
  assert.ok(kinds.length > 20, "found the rules' collections");
  assert.deepEqual(missing(kinds), []);
});

test("every collection(\"…\") literal in the server, MCP and scripts has an owner", () => {
  const kinds: string[] = [];
  for (const f of [...files("src"), ...files("mcp"), ...files("scripts")]) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/collection(?:Group)?\(\s*["'`]([A-Za-z]+)["'`]\s*\)/g)) kinds.push(m[1]);
    for (const m of s.matchAll(/\.doc\(\s*["'`]([A-Za-z]+)\//g)) kinds.push(m[1]);
    // Collection names kept in constants: const X = "name"; used as collection(X).
    for (const m of s.matchAll(/(?:COLLECTION|_USERS|_REQUESTS|_DOC)\s*=\s*"([A-Za-z]+)(?:\/[A-Za-z]+)?"/g)) kinds.push(m[1]);
  }
  assert.ok(kinds.length > 10, "found collection literals");
  assert.deepEqual(missing(kinds), []);
});

test("the Writer's shared kinds are the owner table's", () => {
  assert.deepEqual([...SHARED_KINDS].sort(), Object.entries(OWNERS).filter(([, o]) => o === "shared").map(([k]) => k).sort());
  for (const k of ["venues", "acts", "promoters", "festivals", "editions", "venueTypes"]) assert.equal(ownerOf(k), "shared");
});

test("pathOf: top-level kinds are their name; sub-collections live under their parent; artist kinds need the artist", () => {
  assert.equal(pathOf("shows", { artistId: "a1" }), "shows");
  assert.equal(pathOf("venues"), "venues");
  assert.equal(pathOf("showDeals", { artistId: "a1" }), "showDeals");
  assert.equal(pathOf("comments", { artistId: "a1", parent: { kind: "pitches", id: "p1" } }), "pitches/p1/comments");
  assert.equal(pathOf("tracks", { artistId: "a1", parent: { kind: "releases", id: "r1" } }), "releases/r1/tracks");
  assert.throws(() => pathOf("shows"), /needs the artistId/);
  assert.throws(() => pathOf("comments", { artistId: "a1" }), /needs its parent/);
  assert.throws(() => pathOf("tracks", { artistId: "a1", parent: { kind: "shows", id: "s1" } }), /doesn't live under/);
  assert.throws(() => pathOf("nope"), /No owner/);
});
