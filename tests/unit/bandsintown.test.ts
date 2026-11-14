import { test } from "node:test";
import assert from "node:assert/strict";
import { matchEvent, withBandsintownItem, type BitEvent } from "@/server/bandsintown";
import { bandsintownEligible, bandsintownNewEventUrl } from "@/lib/bandsintown";

const ev = (date: string, name: string, city: string): BitEvent => ({ id: "1", datetime: `${date}T20:00:00`, venue: { name, city } });

test("matchEvent: same date and the same city, or a venue name sharing a word", () => {
  const show = { date: "2026-11-14", venue: { id: "v", name: "The Magic Rat", city: "Fort Collins" } } as never;
  assert.ok(matchEvent(show, "The Magic Rat", [ev("2026-11-14", "Magic Rat Live Music", "Fort Collins")]));
  assert.ok(matchEvent(show, "The Magic Rat", [ev("2026-11-14", "Somewhere", "Fort Collins")]), "city alone is enough");
  assert.ok(matchEvent({ date: "2026-11-14", venue: { id: "v", name: "The Magic Rat" } } as never, "The Magic Rat", [ev("2026-11-14", "Magic Rat Live Music", "Ft. Collins")]), "venue word alone is enough");
  assert.equal(matchEvent(show, "The Magic Rat", [ev("2026-11-15", "Magic Rat Live Music", "Fort Collins")]), undefined, "another day");
  assert.equal(matchEvent({ date: "2026-11-14", venue: { id: "v", name: "The Live Bar" } } as never, "The Live Bar", [ev("2026-11-14", "Live Music Bar", "Denver")]), undefined, "filler words don't match");
});

test("withBandsintownItem: into the first Promotion template's list, else any Promotion list, else a new Promotion list; never twice", () => {
  const item = (l: { items: { bandsintown?: true; label: string }[] }) => l.items.filter((i) => i.bandsintown).map((i) => i.label);
  const lists = [{ id: "a", name: "PA", templateId: "pa", items: [] }, { id: "b", name: "Promo", templateId: "promo", items: [{ id: "x", label: "Poster", done: false }] }];
  const next = withBandsintownItem(lists, ["promo"], "promo")!;
  assert.deepEqual(next.map(item), [[], ["Add to Bandsintown"]]);
  assert.equal(withBandsintownItem(next, ["promo"], "promo"), null);
  const other = withBandsintownItem(lists, ["promo", "promo2"], "promo2")!;
  assert.deepEqual(other.map(item), [[], ["Add to Bandsintown"]], "a later Promotion template's list when the first isn't on the show");
  const fresh = withBandsintownItem([{ id: "a", name: "PA", templateId: "pa", items: [] }], [], undefined)!;
  assert.deepEqual(fresh.map((l) => [l.name, l.templateId, item(l)]), [["PA", "pa", []], ["Promotion", null, ["Add to Bandsintown"]]]);
});

test("bandsintownEligible: confirmed, today or later, venue or festival", () => {
  const s = (x: object) => ({ date: "2026-11-20", status: "confirmed", venue: { id: "v", name: "V" }, ...x }) as never;
  assert.equal(bandsintownEligible(s({}), "2026-11-14"), true);
  assert.equal(bandsintownEligible(s({ status: "hold" }), "2026-11-14"), false);
  assert.equal(bandsintownEligible(s({ date: "2026-11-01" }), "2026-11-14"), false);
  assert.equal(bandsintownEligible(s({ kind: "house", venue: undefined, hostName: "Kim" }), "2026-11-14"), false);
  assert.equal(bandsintownEligible(s({ kind: "festival" }), "2026-11-14"), true);
  assert.equal(bandsintownNewEventUrl("15563770"), "https://artists.bandsintown.com/artists/15563770/events/new?version=multi-step&step=type");
  assert.equal(bandsintownNewEventUrl(undefined), null);
});
