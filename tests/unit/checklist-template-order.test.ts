import { test } from "node:test";
import assert from "node:assert/strict";
import { reorderWithinKind } from "@/components/shows/checklists/ChecklistTemplatesEditor";

const all = [
  { id: "s1" }, { id: "r1", appliesTo: "release" as const }, { id: "s2", appliesTo: "show" as const },
  { id: "x1", appliesTo: "social" as const }, { id: "s3" }, { id: "r2", appliesTo: "release" as const },
];

test("dragging within a tab keeps the other kinds' slots and fills this kind's slots in its new order", () => {
  assert.deepEqual(reorderWithinKind(all, "show", 2, 0), ["s3", "r1", "s1", "x1", "s2", "r2"]);
  assert.deepEqual(reorderWithinKind(all, "release", 0, 1), ["s1", "r2", "s2", "x1", "s3", "r1"]);
  assert.deepEqual(reorderWithinKind(all, "social", 0, 0), all.map((t) => t.id));
});

test("byWhenThenOrder: Pre Show, Day Of, Post Show, then no When, each by order", async () => {
  const { byWhenThenOrder } = await import("@/components/shows/checklists/shared");
  const ts = [{ id: "a", order: 0 }, { id: "b", order: 1, when: "postShow" }, { id: "c", order: 2, when: "preShow" }, { id: "d", order: 3, when: "dayOf" }, { id: "e", order: 4, when: "preShow" }];
  assert.deepEqual(byWhenThenOrder(ts).map((t) => t.id), ["c", "e", "d", "b", "a"]);
});
