import { test } from "node:test";
import assert from "node:assert/strict";
import { traceWhoWeKnow, venuesWeKnow, knownActIds, type TraceData } from "@/lib/whoWeKnow";

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
