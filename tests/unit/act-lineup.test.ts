import { test } from "node:test";
import assert from "node:assert/strict";
import { ActRecord, nextLineup } from "../../src/schema/acts";

test("the Solo / Band pill steps unset → Band → Solo → unset", () => {
  assert.equal(nextLineup(undefined), "band");
  assert.equal(nextLineup(null), "band");
  assert.equal(nextLineup("band"), "solo");
  assert.equal(nextLineup("solo"), null);
});

test("an act's lineup is solo or band, nothing else", () => {
  const base = { name: "Example Act" };
  assert.ok(ActRecord.safeParse({ ...base, lineup: "solo" }).success);
  assert.ok(ActRecord.safeParse({ ...base, lineup: "band" }).success);
  assert.ok(!ActRecord.safeParse({ ...base, lineup: "duo" }).success);
});
