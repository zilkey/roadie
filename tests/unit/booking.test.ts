/** Booking helpers (templates, search, application dates), with no database. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTemplate, unfilledFields, buildTemplateContext, buildSearchItems, searchItems, appsOpenThisMonth, upcomingDeadlines } from "@/lib/booking";

test("pure helpers: fill, unfilled, context, search, application dates", () => {
  assert.equal(fillTemplate("Hi {{contact.firstName}} at {{ venue.name }} {{nope}}", { "contact.firstName": "Rosa", "venue.name": "Pine Hollow" }), "Hi Rosa at Pine Hollow {{nope}}");
  assert.deepEqual(unfilledFields("{{a}} {{b.c}} {{a}}"), ["a", "b.c"]);
  const c = buildTemplateContext({ target: { kind: "venue", name: "Pine Hollow" }, contact: { name: "Rosa Jackson" }, user: { name: "Rudy Smith" } });
  assert.equal(c["venue.name"], "Pine Hollow");
  assert.equal(c["contact.firstName"], "Rosa");
  assert.equal(c["user.firstName"], "Rudy");
  const items = buildSearchItems({
    venues: [{ id: "v1", name: "Pine Hollow", address: { city: "Denver" }, contactIds: ["c1"] }, { id: "v2", name: "Fox", address: { city: "Boulder" }, contactIds: [] }],
    promoters: [], festivals: [], contacts: [{ id: "c1", name: "Rosa Jackson", emails: ["h@x.com"] }],
  });
  assert.deepEqual(searchItems(items, "denver").map((i) => i.id), ["v1"]);
  assert.deepEqual(searchItems(items, "rosa").map((i) => i.id).sort(), ["c1", "v1"]);
  assert.equal(searchItems(items, "boulder fox").length, 1);
  const eds = [
    { id: "a", appOpens: { date: "2026-10-30" }, appDeadline: { date: "2027-01-15" } },
    { id: "b", appOpens: { date: "2026-12-01" } }, { id: "c", appOpens: { date: "2026-09-01" }, appDeadline: { date: "2026-10-01" } },
    { id: "d", appOpens: { date: "2026-09-01" }, appDeadline: { date: "2026-11-01" } },
  ];
  assert.deepEqual(appsOpenThisMonth(eds, "2026-10-23").map((e) => e.id), ["a", "d"]);
  assert.deepEqual(upcomingDeadlines(eds, "2026-10-23", 30).map((e) => e.id), ["d"]);
});
