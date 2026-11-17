import { test } from "node:test";
import assert from "node:assert/strict";
import { stampDump, validateRow, zoneDump, type Dump } from "@/server/backup";

// Tenancy phase 4: `restore --artist` gives an older backup's rows their artist in memory (the phase-3 rules), so it validates
// and restores into a working state.

const common = (id: string, extra: Record<string, unknown> = {}) => ({
  id, schemaVersion: 1, createdAt: { __ts: { seconds: 1_700_000_000, nanoseconds: 0 } }, updatedAt: { __ts: { seconds: 1_700_000_000, nanoseconds: 0 } }, createdBy: "import", updatedBy: "import", via: "import", runId: "r", deletedAt: null, rev: 1, ...extra,
});

test("records, sub-collections, history and memberships get their artist", () => {
  const dump: Dump = {
    users: [{ path: "users/u1", data: common("u1", { createdBy: "u1", email: "ann@x.example", name: "Ann", artists: [{ artistId: "A", role: "admin" }], musicianId: "m1" }) }],
    musicians: [{ path: "musicians/m1", data: common("m1", { name: "Ann", instruments: ["bass"], active: true }) }],
    shows: [
      { path: "shows/s1", data: common("s1", { artistId: "B" }) },
      { path: "shows/s1/comments/c1", data: common("c1", { authorId: "u1", body: "hi" }) },
      { path: "shows/s1/history/000001", data: common("000001", { entity: { kind: "shows", id: "s1" }, op: "create", diff: {} }) },
    ],
    songs: [{ path: "songs/g1", data: common("g1", { createdBy: "u1", title: "Song", status: "active" }) }],
    venues: [{ path: "venues/v1/history/000001", data: common("000001", { entity: { kind: "venues", id: "v1" }, op: "create", diff: {} }) }],
  };
  const n = stampDump(dump, "A");
  assert.ok(n >= 6);
  const at = (p: string) => Object.values(dump).flat().find((r) => r.path === p)!.data as Record<string, unknown>;
  assert.equal(at("musicians/m1").artistId, "A", "made by a script: the named artist");
  assert.equal(at("songs/g1").artistId, "A", "its creator's only artist");
  assert.equal(at("shows/s1/comments/c1").artistId, "B", "its parent's");
  assert.equal(at("shows/s1/history/000001").artistId, "B");
  assert.equal(at("venues/v1/history/000001").shared, true);
  assert.deepEqual(at("users/u1").artists, [{ artistId: "A", role: "admin", musicianId: "m1" }]);
  assert.deepEqual(at("users/u1").artistIds, ["A"]);
  assert.deepEqual(validateRow({ path: "songs/g1", data: at("songs/g1") }), []);
});

test("an older backup's artist with no time zone restores as America/Denver; one with a zone keeps it", () => {
  const dump: Dump = {
    artists: [
      { path: "artists/A", data: common("A", { name: "A", slug: "a", configurations: [], links: {}, driveFolderId: "" }) },
      { path: "artists/B", data: common("B", { name: "B", slug: "b", configurations: [], links: {}, driveFolderId: "", timeZone: "America/New_York" }) },
    ],
  };
  assert.equal(zoneDump(dump), 1);
  assert.equal((dump.artists[0].data as { timeZone: string }).timeZone, "America/Denver");
  assert.equal((dump.artists[1].data as { timeZone: string }).timeZone, "America/New_York");
  assert.equal(zoneDump(dump), 0, "a second pass changes nothing");
});
