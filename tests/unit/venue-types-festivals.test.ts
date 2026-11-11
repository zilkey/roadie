// Covers the pure festivalRows list builder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { festivalRows } from "@/lib/festivalPage";

test("festivalRows: by name keeps each festival's newest year first", () => {
  const rows = festivalRows({
    festivals: [{ id: "b", name: "Beta" }, { id: "a", name: "Alpha" }],
    editions: [{ id: "a1", festivalId: "a", year: 2026 }, { id: "a2", festivalId: "a", year: 2027 }],
    contacts: [],
  }, "", "name");
  assert.deepEqual(rows, [{ kind: "edition", id: "a2" }, { kind: "edition", id: "a1" }, { kind: "festival", id: "b" }]);
});
