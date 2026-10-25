import { test } from "node:test";
import assert from "node:assert/strict";
import { finishTerms, scanContents, termsFromBandSource, termsFromBookingKit } from "../../scripts/leak-check";

test("band source yields emails and person names; booking kit yields contact fields", () => {
  const band = [
    'export const BAND_PEOPLE: DevPerson[] = [',
    '  { key: "a", name: "Zed Quux", email: "zed.quux@gmail.test", role: "admin" },',
    '  { key: "b", name: "Solo", email: "dev@zilkey.example", role: "member" },',
    '];',
  ].join("\n");
  const fromBand = finishTerms(termsFromBandSource(band));
  assert.deepEqual(fromBand.sort(), ["Zed Quux", "zed.quux@gmail.test"].sort());

  const kit = {
    contacts: [{ name: "Pat Venue", phone: "555-0100", email: "pat@venue.test" }],
    notes: "reach out to ops@house.test",
  };
  const fromKit = finishTerms(termsFromBookingKit(kit));
  assert.ok(fromKit.includes("Pat Venue"));
  assert.ok(fromKit.includes("555-0100"));
  assert.ok(fromKit.includes("pat@venue.test"));
  assert.ok(fromKit.includes("ops@house.test"));
});

test("short terms and allow-listed emails are dropped", () => {
  const terms = finishTerms(["Al", "x@zilkey.io", "bot@example.com", "ops@host.example", "Longer Name"]);
  assert.deepEqual(terms, ["Longer Name"]);
});

test("scanContents matches case-insensitively and reports file and term", () => {
  const files = [
    { path: "a.md", content: "Contact PAT VENUE tonight" },
    { path: "b.md", content: "nothing here" },
  ];
  assert.deepEqual(scanContents(files, ["pat venue"]), [{ file: "a.md", term: "pat venue" }]);
  assert.deepEqual(scanContents(files, ["missing term"]), []);
});
