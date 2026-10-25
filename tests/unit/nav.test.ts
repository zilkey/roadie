import { test } from "node:test";
import assert from "node:assert/strict";
import { navFor } from "@/lib/nav";
import { DEFAULT_HIDDEN, DEFAULT_SECTION_ORDER, SECTION_IDS, normalizeOrder } from "@/schema/sections";

const keys = (items: { key: string }[]) => items.map((n) => n.key);
const label = (items: { key: string; label: string }[], key: string) => items.find((n) => n.key === key)?.label;

test("admin gets Home plus all eight sections in the default order, with Money", () => {
  const nav = navFor("admin", [...DEFAULT_SECTION_ORDER]);
  assert.deepEqual(keys(nav), ["home", ...SECTION_IDS]);
  assert.equal(SECTION_IDS.length, 8);
  assert.equal(label(nav, "money"), "Money");
});

test("members don't get booking or email templates, and see My money", () => {
  const nav = navFor("member", [...DEFAULT_SECTION_ORDER]);
  assert.deepEqual(keys(nav), ["home", "shows", "calendar", "songs", "setlists", "rehearsals", "money"]);
  assert.ok(!keys(nav).includes("booking") && !keys(nav).includes("templates"));
  assert.equal(label(nav, "money"), "My money");
});

test("a custom order is respected; sections it leaves out are appended", () => {
  const order = normalizeOrder(["money", "songs"]);
  assert.deepEqual(order, ["money", "songs", "shows", "calendar", "booking", "templates", "setlists", "rehearsals"]);
  assert.deepEqual(keys(navFor("admin", order)), ["home", ...order]);
  assert.deepEqual(keys(navFor("member", order)), ["home", "money", "songs", "shows", "calendar", "setlists", "rehearsals"]);
});

test("templates, setlists and rehearsals start hidden", () => {
  assert.deepEqual([...DEFAULT_HIDDEN], ["templates", "setlists", "rehearsals"]);
});
