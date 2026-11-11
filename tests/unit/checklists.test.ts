/** Checklists: the Home open-items rule, with no database. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openItemsFor } from "@/lib/shows";

test("Home: open items for the viewer are theirs or unassigned, across lists", () => {
  const ls = [
    { id: "a", name: "Promo", items: [{ id: "1", label: "Poster", done: false, ownerId: "me" }, { id: "2", label: "Email", done: false }, { id: "3", label: "Social", done: true, ownerId: "me" }] },
    { id: "b", name: "Load-out", items: [{ id: "4", label: "Amp", done: false, ownerId: "you" }, { id: "5", label: "Sweep", done: false }] },
  ];
  assert.deepEqual(openItemsFor(ls, "me").map((i) => [i.id, i.listId]), [["1", "a"], ["2", "a"], ["5", "b"]]);
  assert.deepEqual(openItemsFor(ls).map((i) => i.id), ["2", "5"]);
});
