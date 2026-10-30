import { test } from "node:test";
import assert from "node:assert/strict";
import { navFor } from "@/lib/nav";
import { DEFAULT_HIDDEN, DEFAULT_SECTION_ORDER, defaultHidden, SECTION_IDS, normalizeOrder } from "@/schema/sections";

const keys = (items: { key: string }[]) => items.map((n) => n.key);
const label = (items: { key: string; label: string }[], key: string) => items.find((n) => n.key === key)?.label;

test("admin gets Calendar then all twelve sections in the default order, with Money (Fans when the artist has it on)", () => {
  const nav = navFor("admin", [...DEFAULT_SECTION_ORDER], { fans: true });
  assert.deepEqual(keys(nav), ["calendar", ...SECTION_IDS]);
  assert.equal(SECTION_IDS.length, 12);
  assert.deepEqual(keys(navFor("admin", [...DEFAULT_SECTION_ORDER])), ["calendar", ...SECTION_IDS.filter((s) => s !== "fans")]);
  assert.equal(label(nav, "money"), "Money");
});

test("members don't get booking, email templates, releases or posts, and see My money", () => {
  const nav = navFor("member", [...DEFAULT_SECTION_ORDER]);
  assert.deepEqual(keys(nav), ["calendar", "shows", "tours", "songs", "setlists", "rehearsals", "stagePlots", "money"]);
  assert.ok(!keys(nav).includes("booking") && !keys(nav).includes("templates") && !keys(nav).includes("releases") && !keys(nav).includes("posts"));
  assert.equal(label(nav, "money"), "My money");
});

test("members see Fans (counts only) when it is on", () => {
  assert.ok(keys(navFor("member", [...DEFAULT_SECTION_ORDER], { fans: true })).includes("fans"));
  assert.ok(!keys(navFor("member", [...DEFAULT_SECTION_ORDER])).includes("fans"));
});

test("a custom order is respected; sections it leaves out are appended", () => {
  const order = normalizeOrder(["money", "songs"]);
  assert.deepEqual(order, ["money", "songs", "shows", "booking", "templates", "tours", "releases", "setlists", "rehearsals", "stagePlots", "fans", "posts"]);
  assert.deepEqual(keys(navFor("admin", order, { fans: true })), ["calendar", ...order]);
  assert.deepEqual(keys(navFor("member", order)), ["calendar", "money", "songs", "shows", "tours", "setlists", "rehearsals", "stagePlots"]);
});

test("templates, releases, setlists, rehearsals, stage plots and posts start hidden", () => {
  assert.deepEqual([...DEFAULT_HIDDEN], ["templates", "releases", "setlists", "rehearsals", "stagePlots", "posts"]);
  assert.deepEqual(defaultHidden("admin"), [...DEFAULT_HIDDEN]);
});

test("a member starts with Rehearsals in the nav and My money in More", () => {
  assert.deepEqual(defaultHidden("member"), ["templates", "setlists", "stagePlots", "money"]);
});
