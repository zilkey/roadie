import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOrder, buildBoard, dismissedLists, movedOrder, type BoardInput } from "@/lib/todos";

const item = (id: string, label: string, extra: Record<string, unknown> = {}) => ({ id, label, done: false, ...extra });
const base = (over: Partial<BoardInput> = {}): BoardInput => ({
  artistId: "a1", today: "2026-11-12", order: {}, dismissed: [], showDone: false, mine: null, pitches: [], todos: [],
  shows: [
    { id: "s2", date: "2026-12-04", status: "confirmed", venue: { name: "Mercury Cafe" } as never, checklists: [{ id: "l1", name: "Advance", items: [item("m1", "Send the input list")] }] },
    { id: "s1", date: "2026-11-14", status: "confirmed", venue: { name: "Hi-Dive" } as never, checklists: [
      { id: "l1", name: "Advance", items: [item("i1", "Send stage plot", { pinnedAt: "x", ownerId: "dean" }), item("i2", "Confirm load-in", { ownerId: "dean" }), item("i3", "Parking"), item("i4", "Done one", { done: true })] },
      { id: "l2", name: "Promo", items: [item("p1", "Print posters", { ownerId: "ingrid" })] },
    ] },
    { id: "s0", date: "2026-11-01", status: "played", venue: { name: "Old" } as never, checklists: [{ id: "l1", name: "After", items: [item("o1", "Thank them")] }] },
    { id: "s3", date: "2026-11-20", status: "canceled", venue: { name: "Gone" } as never, checklists: [{ id: "l1", name: "Advance", items: [item("g1", "Never", { pinnedAt: "x" })] }] },
  ],
  releases: [{ id: "r1", title: "Spring EP", checklists: [{ id: "l1", name: "Manufacturing", items: [item("t1", "Approve the test pressing", { pinnedAt: "x" }), item("t2", "Send final art")] }] }],
  social: [{ id: "l9", name: "Hi-Dive promo", items: [item("x1", "Tag the venue")] }],
  ...over,
});
const col = (cols: ReturnType<typeof buildBoard>, key: string) => cols.find((c) => c.key === key)!;
const keys = (c: ReturnType<typeof buildBoard>[number]) => c.groups.flatMap((g) => g.items.map((i) => i.key));

test("columns: Pinned, Booking, upcoming live shows soonest first, Releases, Social Media, Our list", () => {
  const cols = buildBoard(base());
  assert.deepEqual(cols.map((c) => c.key), ["pinned", "booking", "show:s1", "show:s2", "releases", "social", "our"]);
  assert.deepEqual(keys(col(cols, "pinned")), ["show:s1:l1:i1", "release:r1:l1:t1"], "canceled shows' pins never show");
  assert.deepEqual(col(cols, "pinned").groups[0].items.map((i) => i.source?.text), ["Sat Nov 14 Hi-Dive › Advance", "Spring EP › Manufacturing"]);
  const hi = col(cols, "show:s1");
  assert.equal(hi.title, "Sat Nov 14 · Hi-Dive");
  assert.deepEqual(hi.groups.map((g) => [g.key, g.done, g.total, g.items.map((i) => i.key)]), [
    ["show:s1:l1", 1, 4, ["show:s1:l1:i2", "show:s1:l1:i3"]], ["show:s1:l2", 0, 1, ["show:s1:l2:p1"]],
  ], "pinned and done items are left out; N of M counts the whole list");
  assert.deepEqual(col(cols, "releases").groups[0].titleLink, { text: "Spring EP", href: "/releases/r1" });
});

test("Mine, Show done and Dismiss", () => {
  const mine = buildBoard(base({ mine: { musicianId: "ingrid", userId: "u1" } }));
  assert.deepEqual(keys(col(mine, "show:s1")), ["show:s1:l1:i3", "show:s1:l2:p1"], "mine = mine or nobody's");
  const done = buildBoard(base({ showDone: true }));
  assert.ok(keys(col(done, "show:s1")).includes("show:s1:l1:i4"));
  const dis = buildBoard(base({ dismissed: ["show:s2:l1", "release:r1:l1"] }));
  assert.ok(!dis.some((c) => c.key === "show:s2"), "a show with nothing left loses its column");
  assert.deepEqual(keys(col(dis, "pinned")), ["show:s1:l1:i1", "release:r1:l1:t1"], "pins stay when their list is dismissed");
  assert.deepEqual(dismissedLists(base({ dismissed: ["show:s2:l1", "show:zz:l1"] })), [{ key: "show:s2:l1", title: "Fri Dec 4 Mercury Cafe › Advance" }]);
});

test("Booking: due next steps and quiet pitches, Mine by assignee", () => {
  const at = (d: string) => ({ toMillis: () => Date.parse(d + "T18:00:00Z") });
  const pitches = [
    { id: "p1", status: "talking", target: { kind: "venue", id: "v1", name: "Lost Lake" }, nextStep: { text: "Send avails", due: "2026-11-09" }, lastContactAt: at("2026-11-08"), assigneeId: "u2" },
    { id: "p2", status: "talking", target: { kind: "venue", id: "v2", name: "Globe Hall" }, lastContactAt: at("2026-10-22") },
    { id: "p3", status: "pitched", target: { kind: "venue", id: "v3", name: "Fresh" }, lastContactAt: at("2026-11-10") },
  ];
  const b = col(buildBoard(base({ pitches })), "booking").groups[0].items;
  assert.deepEqual(b.map((i) => [i.key, i.label, i.chip?.text, i.action]), [
    ["pitch:p2", "Follow up with Globe Hall", "21 days quiet", { type: "pitch", id: "p2", due: false }],
    ["pitch:p1", "Send avails", "Due Mon Nov 9", { type: "pitch", id: "p1", due: true }],
  ]);
  assert.deepEqual(keys(col(buildBoard(base({ pitches, mine: { userId: "u1" } })), "booking")), ["pitch:p2"]);
});

test("saved order first, the rest after in natural order; moving stays inside a group", () => {
  assert.deepEqual(applyOrder([{ key: "a" }, { key: "b" }, { key: "c" }], ["c", "zz", "a"]).map((x) => x.key), ["c", "a", "b"]);
  const cols = buildBoard(base({ order: { "show:s1": ["show:s1:l1:i3"] } }));
  const hi = col(cols, "show:s1");
  assert.deepEqual(keys(hi), ["show:s1:l1:i3", "show:s1:l1:i2", "show:s1:l2:p1"]);
  assert.deepEqual(movedOrder(hi, 0, 0, 1), ["show:s1:l1:i2", "show:s1:l1:i3", "show:s1:l2:p1"]);
});

test("the band's own lists: a column each (even empty), after Our list; their pins go to Pinned", () => {
  const lists = [
    { id: "b1", name: "Van stuff", items: [item("v1", "Oil change"), item("v2", "New tires", { pinnedAt: "x" })] },
    { id: "b2", name: "Merch", items: [] },
  ];
  const cols = buildBoard(base({ lists }));
  assert.deepEqual(cols.map((c) => c.key).slice(-3), ["our", "list:b1", "list:b2"]);
  const van = col(cols, "list:b1");
  assert.deepEqual([van.title, van.chip, van.board], ["Van stuff", "Van stuff", { listId: "b1" }]);
  assert.deepEqual(keys(van), ["board:a1:b1:v1"]);
  assert.equal(van.groups[0].title, undefined, "no group title, so no Dismiss: the list is the column");
  assert.deepEqual(van.groups[0].add, { type: "checklist", kind: "board", id: "a1", listId: "b1" });
  assert.deepEqual(col(cols, "list:b2").groups.map((g) => g.items.length), [0], "an empty list keeps its group, to add to");
  const pin = col(cols, "pinned").groups[0].items.find((i) => i.key === "board:a1:b1:v2")!;
  assert.deepEqual([pin.source, pin.action], [{ text: "Van stuff" }, { type: "checklist", kind: "board", id: "a1", listId: "b1", itemId: "v2" }]);
});

test("every list adds to-dos except Booking: checklists add to themselves, Our list to todos, Pinned to todos pinned", () => {
  const cols = buildBoard(base({ todos: [{ id: "t1", label: "Renew ASCAP", done: false }, { id: "t2", label: "Book the van", done: false, pinnedAt: "x" }] }));
  assert.equal(col(cols, "booking").groups[0].add, undefined);
  assert.deepEqual(col(cols, "pinned").groups[0].add, { type: "todo", pinned: true });
  assert.deepEqual(col(cols, "our").groups[0].add, { type: "todo" });
  assert.deepEqual(col(cols, "show:s1").groups.map((g) => g.add), [
    { type: "checklist", kind: "show", id: "s1", listId: "l1" }, { type: "checklist", kind: "show", id: "s1", listId: "l2" },
  ]);
  assert.deepEqual(col(cols, "releases").groups[0].add, { type: "checklist", kind: "release", id: "r1", listId: "l1" });
  assert.deepEqual(col(cols, "social").groups[0].add, { type: "checklist", kind: "social", id: "a1", listId: "l9" });
  assert.deepEqual(keys(col(cols, "our")), ["todo:t1"], "a pinned to-do leaves Our list");
  const p = col(cols, "pinned").groups[0].items.find((i) => i.key === "todo:t2")!;
  assert.deepEqual([p.pinned, p.source], [true, { text: "Our list" }]);
});
