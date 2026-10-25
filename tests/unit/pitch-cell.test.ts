import { test } from "node:test";
import assert from "node:assert/strict";
import { pitchCellText } from "@/lib/booking";

const configs = [{ id: "c1", name: "Full band" }, { id: "c2", name: "Duo" }];

test("a known configuration shows its name", () => {
  assert.equal(pitchCellText({ pitchedAs: "c2", dates: [] }, configs).config, "Duo");
});

test("an unknown or missing configuration says Not sure yet", () => {
  assert.equal(pitchCellText({ pitchedAs: "gone" }, configs).config, "Not sure yet");
  assert.equal(pitchCellText({ pitchedAs: null }, configs).config, "Not sure yet");
  assert.equal(pitchCellText({}, configs).config, "Not sure yet");
});

test("dates are sorted and formatted like Sat, Sep 12", () => {
  assert.equal(pitchCellText({ dates: ["2027-01-23", "2026-09-12", "2027-01-16"] }, configs).dates, "Sat, Sep 12, Sat, Jan 16, Sat, Jan 23");
});

test("no dates says No dates yet", () => {
  assert.equal(pitchCellText({ dates: [] }, configs).dates, "No dates yet");
  assert.equal(pitchCellText({}, configs).dates, "No dates yet");
});
