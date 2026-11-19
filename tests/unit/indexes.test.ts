import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rangedQueries, serves, type Field } from "../../scripts/list-ranged-queries";

// Tenancy plan D7: db.ts adds where("artistId", "==", …) to every query on an artist kind. A query that also orders, ranges or
// filters an array then needs a composite index in prod, and the emulator never says so: this test is the only check.

const ix = JSON.parse(readFileSync("firestore.indexes.json", "utf8")) as { indexes: { collectionGroup: string; queryScope: string; fields: Field[] }[] };

/**
 * Queries whose kind is in a variable, so the scanner can't read them. Each is listed with why it needs no new index: equality
 * only (merged single-field indexes), run inside `w.system()` (no artist filter is added), or covered by an index listed by hand.
 */
const KNOWN_UNREAD: Record<string, string> = {
  "src/server/commands/booking.ts:venueIds": "venues.mergeInto, inside w.system(): no artistId filter",
  "src/server/commands/booking.ts:contactIds": "festivalNotes/promoterNotes/actNotes (artistId, contactIds CONTAINS): listed by hand",
  "src/server/commands/music.ts:rehearsalId": "equality only",
  "src/server/commands/projects.ts:projectId": "equality only",
  "src/server/commands/tours.ts:showId": "equality only",
  "src/server/commands/tours.ts:tourEntryId": "equality only",
  "src/server/commands/tours.ts:tourId": "equality only",
  "src/server/dealTotals.ts:showId": "equality only",
};

test("every ranged query on an artist kind has its composite index", () => {
  const { needed } = rangedQueries();
  const missing = needed.filter((n) => !ix.indexes.some((i) => serves(i, n)))
    .map((n) => `${n.collectionGroup} (${n.queryScope}) ${n.fields.map((f) => `${f.fieldPath} ${f.order ?? f.arrayConfig}`).join(", ")} for ${n.at}`);
  assert.deepEqual(missing, [], "add these to firestore.indexes.json (npx tsx scripts/list-ranged-queries.ts lists them)");
});

test("every query the scanner can't read is accounted for", () => {
  const { unread } = rangedQueries();
  const src = (at: string) => { const [f, l] = at.split(":"); return readFileSync(f, "utf8").split("\n")[Number(l) - 1]; };
  const keys = unread.map((at) => `${at.split(":")[0]}:${/\.where\(\s*"([\w.]+)"/.exec(src(at))?.[1] ?? "?"}`);
  assert.deepEqual([...new Set(keys)].filter((k) => !KNOWN_UNREAD[k]), [], "say why each needs no index (KNOWN_UNREAD), or add one");
});

test("the plan's server indexes are there (D4, D7)", () => {
  const has = (g: string, scope: string, fields: string) => ix.indexes.some((i) => i.collectionGroup === g && i.queryScope === scope && i.fields.map((f) => f.fieldPath).join(",") === fields);
  assert.ok(has("history", "COLLECTION_GROUP", "artistId,actor.uid,createdAt"), "history.myRuns");
  assert.ok(has("tracks", "COLLECTION_GROUP", "artistId,songId"));
  assert.ok(has("tracks", "COLLECTION_GROUP", "artistId,deletedAt"));
  for (const i of ix.indexes.filter((x) => x.collectionGroup === "history" && x.fields[0].fieldPath === "artistId" && x.fields[1].fieldPath !== "shared" && x.fields[1].fieldPath !== "actor.uid")) {
    const twin = ["artistId", "shared", ...i.fields.slice(1).map((f) => f.fieldPath)].join(",");
    assert.ok(has("history", "COLLECTION_GROUP", twin), `the (artistId, shared, …) twin of ${i.fields.map((f) => f.fieldPath).join(",")}`);
  }
});

test("phase 10: every kind that moves under its artist can be found across artists (collection-group id and artistId)", async () => {
  const { OWNERS, PARENTS, movesUnderArtist } = await import("@/schema/owners");
  const all = JSON.parse(readFileSync("firestore.indexes.json", "utf8")) as { fieldOverrides: { collectionGroup: string; fieldPath: string; indexes: { queryScope: string }[] }[] };
  const cg = (k: string, f: string) => all.fieldOverrides.some((o) => o.collectionGroup === k && o.fieldPath === f && o.indexes.some((i) => i.queryScope === "COLLECTION_GROUP"));
  const tops = Object.keys(OWNERS).filter((k) => movesUnderArtist(k) && !(PARENTS[k] && !PARENTS[k].keyedById));
  // The system view's lookups by id (src/server/db.ts artistDir) and its whole-database queries filtered by artist.
  assert.deepEqual(tops.flatMap((k) => ["id", "artistId"].filter((f) => !cg(k, f)).map((f) => `${k}.${f}`)), []);
  // What the cross-artist hooks and venues.mergeInto filter on (src/server/denorm.ts, commands/booking.ts).
  for (const [k, f] of [["shows", "venue.id"], ["shows", "editionId"], ["shows", "hostContactIds"], ["pitches", "target.id"], ["promoterNotes", "venueIds"], ["venueNotes", "venueId"]]) assert.ok(cg(k, f), `${k}.${f}`);
});
