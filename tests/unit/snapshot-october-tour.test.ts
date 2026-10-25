import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeOctoberTour, type Book } from "../../scripts/snapshot-october-tour";

const HEADER = ["lodging", "Day of Week", "", "Venue", "Location", "Time", "Event Description", "Who", "Set Length", "Sound", "Contact", "Contact info", "Payment", "Estimate", "note", "to-do"];
const values = (): string[][] => [
  HEADER,
  ["provided", "Fri", "10/10", "Fakeville Taproom", "Faketown", "7pm", "Music Venue", "Pat", "60mins", "provided", "Pat Q", "pat@example.test / 5550001111", "$100", "100", "Bring cable"],
  ["Mark", "Sat", "10/11", "Nowhere Hall", "Elsewhere", "TBD", "Listening room", "-", "TBD", "-", "Sam", "", "TBD", "", "no price yet"],
  ["", "Sun", "10/12", "Pending", "X"],
  ["", "Mon", "10/13", "Travel/Rest/Work Day"],
  ["", "", "HOLD"],
  ["x", "Tue", "10/14", "Old Barn", "Fakeville", "7pm", "Listening room", "", "90mins", "", "Lee", "", "$50", "50"],
  ["x", "Wed", "10/15", "Alias Name Here", "Faketown", "8pm", "Brewery", "", "", "", "", "", "$75", "75", "1 Main St Faketown CO 80000"],
];
const book = (): Book => ({
  venues: [
    { id: "old-barn", name: "Old Barn", city: "Fakeville, CO", type: "Listening room", lead: "", link: "", notes: "", contacts: [], shows: [] },
  ],
});

test("qualifying rows become shows; a venue with no match is created", () => {
  const b = book();
  const r = mergeOctoberTour(b, values());
  assert.deepEqual(r.showsAdded.map((s) => `${s.date} ${s.venue}`), ["2025-10-10 fakeville-taproom", "2025-10-14 old-barn", "2025-10-15 alias-name-here"]);
  assert.equal(r.venuesCreated.length, 2);
  const v = b.venues.find((x) => x.id === "fakeville-taproom")!;
  assert.equal(v.city, "Faketown, CO");
  assert.equal(v.type, "Bar / club");
  assert.deepEqual(v.contacts, [{ name: "Pat Q", email: "pat@example.test", phone: "5550001111", note: "" }]);
  assert.equal(v.shows[0].notes, "Lodging: provided. October 2025 CO tour (October Tour - Scenarios, FINAL tab). Bring cable");
  assert.equal(v.shows[0].who, "Ingrid, Jeff");
  assert.equal(b.venues[0].shows[0].date, "2025-10-14", "an existing venue gets the show, not a duplicate venue");
  assert.equal(b.venues.length, 3);
});

test("a street address in the note column goes to where, not the notes", () => {
  const b = book();
  mergeOctoberTour(b, values());
  const s = b.venues.find((x) => x.id === "alias-name-here")!.shows[0];
  assert.equal(s.where, "Faketown, CO (1 Main St)");
  assert.ok(!s.notes.includes("Main St"));
});

test("a named venue with a blank Estimate is skipped and reported; travel and legend rows are not shows", () => {
  const r = mergeOctoberTour(book(), values());
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].venue, "Nowhere Hall");
  assert.match(r.skipped[0].reason, /Estimate/);
  assert.equal(r.notShows, 3);
});

test("a second run changes nothing", () => {
  const b = book();
  mergeOctoberTour(b, values());
  const after = JSON.stringify(b);
  const r = mergeOctoberTour(b, values());
  assert.equal(JSON.stringify(b), after);
  assert.equal(r.showsAdded.length, 0);
  assert.equal(r.venuesCreated.length, 0);
  assert.equal(r.alreadyThere.length, 3);
});
