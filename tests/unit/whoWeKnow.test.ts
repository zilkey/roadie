import { test } from "node:test";
import assert from "node:assert/strict";
import { traceWhoWeKnow, venuesWeKnow, venueNetwork, knownActIds, promoterNetwork, type TraceData } from "@/lib/whoWeKnow";

const base = (): TraceData => ({
  contacts: [
    { id: "kate", name: "Kate", weKnow: true },
    { id: "sam", name: "Sam", weKnow: true },
    { id: "lou", name: "Lou" },
    { id: "gone", name: "Gone", weKnow: true, deletedAt: "2026-01-01" },
  ],
  promoters: [
    { id: "msp", name: "Mountain Sun Pubs", contactIds: ["kate", "lou"] },
    { id: "other", name: "Other Promo", contactIds: ["sam"] },
  ],
  actNotes: [
    { actId: "hay", contactIds: ["sam", "lou"] },
    { actId: "wheel", weKnow: true },
    { actId: "strangers", contactIds: ["lou"] },
  ],
  events: [
    { id: "e1", venueId: "v1", date: "2026-03-13", acts: [{ name: "Big Headliner", role: "headliner", actId: "big" }, { name: "The Haystack Ramblers", role: "support", actId: "hay" }] },
    { id: "e2", venueId: "v1", date: "2026-06-01", acts: [{ name: "The Haystack Ramblers", role: "headliner", actId: "hay" }] },
    { id: "e3", venueId: "v1", date: "2026-04-01", status: "cancelled", acts: [{ name: "Wheelwright", role: "headliner", actId: "wheel" }] },
    { id: "e4", venueId: "v2", date: "2026-05-01", acts: [{ name: "Wheelwright", role: "headliner", actId: "wheel" }] },
    { id: "e5", venueId: "v1", date: "2026-05-01", acts: [{ name: "Strangers", role: "headliner", actId: "strangers" }, { name: "Open Mic", role: "unknown" }] },
  ],
});

test("works there: a known contact on the venue notes, with what they do", () => {
  const paths = traceWhoWeKnow({ id: "v9", contactIds: ["kate", "lou", "gone"], bookingContactIds: ["kate"], dayOfContactIds: ["kate"] }, base());
  assert.deepEqual(paths, [{ kind: "works", contact: { id: "kate", name: "Kate" }, roles: ["books", "dayOf"] }]);
});

test("books there: known contacts of a promoter on the venue's promoterIds or listing the venue in its venueIds", () => {
  const d = base();
  assert.deepEqual(traceWhoWeKnow({ id: "v9", promoterIds: ["msp"] }, d), [
    { kind: "books", contact: { id: "kate", name: "Kate" }, promoter: { id: "msp", name: "Mountain Sun Pubs" } },
  ]);
  d.promoters = [{ ...d.promoters[1], venueIds: ["v9"] }];
  assert.deepEqual(traceWhoWeKnow({ id: "v9" }, d).map((p) => p.kind === "books" && p.promoter.id), ["other"]);
});

test("played there: an act whose person we know, every show newest first with its role; a cancelled show doesn't count", () => {
  const paths = traceWhoWeKnow({ id: "v1" }, base());
  assert.deepEqual(paths, [{
    kind: "played", act: { id: "hay", name: "The Haystack Ramblers" }, actKnown: false, contacts: [{ id: "sam", name: "Sam" }],
    shows: [{ eventId: "e2", date: "2026-06-01", role: "headliner" }, { eventId: "e1", date: "2026-03-13", role: "support" }],
  }]);
});

test("played there: an act we know ourselves, with no contact", () => {
  assert.deepEqual(traceWhoWeKnow({ id: "v2" }, base()), [
    { kind: "played", act: { id: "wheel", name: "Wheelwright" }, actKnown: true, contacts: [], shows: [{ eventId: "e4", date: "2026-05-01", role: "headliner" }] },
  ]);
});

test("nothing known: no paths; flags off or archived contacts don't count", () => {
  const d = base();
  d.contacts = d.contacts.map((c) => ({ ...c, weKnow: false }));
  d.actNotes = d.actNotes.map((n) => ({ ...n, weKnow: false }));
  assert.deepEqual(traceWhoWeKnow({ id: "v1", contactIds: ["kate"], promoterIds: ["msp"] }, d), []);
});

test("all three kinds together, in order: works, books, played", () => {
  const paths = traceWhoWeKnow({ id: "v1", contactIds: ["sam"], promoterIds: ["msp"] }, base());
  assert.deepEqual(paths.map((p) => p.kind), ["works", "books", "played"]);
});

test("venuesWeKnow and knownActIds", () => {
  const d = base();
  assert.deepEqual([...venuesWeKnow([{ id: "v1" }, { id: "v2" }, { id: "v3" }, { id: "v4", promoterIds: ["msp"] }], d)].sort(), ["v1", "v2", "v4"]);
  assert.deepEqual(knownActIds(d), ["hay", "wheel"]);
});

test("venueNetwork: an act with a show from today on is booked (soonest first, past shows counted), the rest played, people around", () => {
  const d = base();
  d.events = [...d.events,
    { id: "e6", venueId: "v1", date: "2026-08-01", acts: [{ name: "Wheelwright", role: "support", actId: "wheel" }] },
    { id: "e7", venueId: "v1", date: "2026-07-01", acts: [{ name: "The Haystack Ramblers", role: "headliner", actId: "hay" }] },
  ];
  const net = venueNetwork({ id: "v1", promoterIds: ["msp"] }, d, "2026-06-01");
  assert.deepEqual(net.booked.map((a) => [a.act.id, a.upcoming.map((s) => s.eventId), a.past.map((s) => s.eventId)]), [
    ["hay", ["e2", "e7"], ["e1"]],
    ["wheel", ["e6"], []],
  ]);
  assert.deepEqual(net.played, []);
  assert.deepEqual(net.around.map((p) => p.kind === "books" && p.contact.id), ["kate"]);

  const later = venueNetwork({ id: "v1" }, d, "2026-12-01");
  assert.deepEqual(later.booked, []);
  assert.deepEqual(later.played.map((a) => [a.act.id, a.past[0].eventId, a.past.length]), [["wheel", "e6", 1], ["hay", "e7", 3]]);
});

// ---------- promoterNetwork (a promoter's Network tab) ----------

test("promoterNetwork: the promoter's own people link to it; acts and venue people link to the rooms they reach", () => {
  const d = base();
  const venues = [
    { id: "v2", name: "Zeta Hall", promoterIds: ["msp"] },
    { id: "v1", name: "Alpha Room", promoterIds: ["msp"], contactIds: ["sam"] },
    { id: "v3", name: "Quiet Bar", promoterIds: ["msp"] },
  ];
  const net = promoterNetwork({ id: "msp", contactIds: ["kate", "lou"] }, venues, d, "2026-05-15");
  // Venues by name, the ones nobody reaches set aside.
  assert.deepEqual(net.venues.map((v) => v.id), ["v1", "v2"]);
  assert.deepEqual(net.unreached.map((v) => v.id), ["v3"]);
  const by = (from: string) => net.links.filter((l) => l.from === from).map(({ to, label, strength }) => ({ to, label, strength }));
  // Kate works for the promoter: one link straight to it, not a "books it" link to each of its rooms.
  assert.deepEqual(by("c:kate"), [{ to: "promoter", label: "works for them", strength: "works" }]);
  assert.deepEqual(by("c:sam"), [{ to: "v1", label: "works here", strength: "works" }]);
  assert.deepEqual(by("a:hay"), [{ to: "v1", label: "plays here 2026-06-01", strength: "booked" }]);
  assert.deepEqual(by("a:strangers"), []); // Lou isn't someone we know, so Strangers isn't reachable
  assert.deepEqual(by("a:wheel"), [{ to: "v2", label: "played here 2026-05-01", strength: "played" }]);
  // Ordered by the rows they link to (Alpha's people by name, then Zeta's, then the promoter's own).
  assert.deepEqual(net.people.map((p) => p.key), ["c:sam", "a:hay", "a:wheel", "c:kate"]);
  assert.deepEqual(net.people.find((p) => p.key === "a:hay")?.via, [{ id: "sam", name: "Sam" }]);
  assert.equal(net.byVenue.get("v1")?.booked.length, 1);
});

test("promoterNetwork: someone booking a room for another promoter still gets us in; an act played twice says so", () => {
  const d = base();
  d.events = [...d.events, { id: "e6", venueId: "v2", date: "2026-02-01", acts: [{ name: "Wheelwright", role: "support", actId: "wheel" }] }];
  const net = promoterNetwork({ id: "msp" }, [{ id: "v2", name: "Zeta Hall", promoterIds: ["msp", "other"] }], d, "2026-05-15", (x) => `on ${x}`);
  // Kate books it for this very promoter, which is the promoter's own link (none here: its contactIds weren't given), not a room link.
  assert.deepEqual(net.links.map(({ from, label }) => ({ from, label })), [
    { from: "c:sam", label: "books it for Other Promo" },
    { from: "a:wheel", label: "played here 2 times" },
  ]);
});

test("promoterNetwork: no venues, or nobody we know, is empty", () => {
  const d = base();
  d.contacts = d.contacts.map((c) => ({ ...c, weKnow: false }));
  d.actNotes = [];
  const net = promoterNetwork({ id: "msp", contactIds: ["kate"] }, [{ id: "v1", name: "Alpha Room" }], d, "2026-05-15");
  assert.deepEqual([net.people, net.links, net.venues], [[], [], []]);
  assert.deepEqual(net.unreached, [{ id: "v1", name: "Alpha Room" }]);
});
