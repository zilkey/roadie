/** History diffing for lists without item ids, with no database. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffDocs } from "@/server/db";

test("whole-field diff stays for lists without item ids", () => {
  const d = diffDocs({ items: [{ title: "a" }] }, { items: [{ title: "b" }] });
  assert.deepEqual(d.items, { before: [{ title: "a" }], after: [{ title: "b" }] });
});
