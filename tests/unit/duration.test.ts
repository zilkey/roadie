import { test } from "node:test";
import assert from "node:assert/strict";
import { describeDuration, endsAt, fmtDuration, parseDuration, setLengthOf } from "@/lib/duration";

test("parseDuration reads the human formats as seconds", () => {
  const cases: [string, number][] = [
    ["2h", 7200], ["2 hours", 7200], ["1 hour", 3600], ["90m", 5400], ["90 min", 5400], ["90 minutes", 5400],
    ["2:30", 9000], ["0:45", 2700], ["1h 45m", 6300], ["1h45m", 6300], ["1 hr and 30 mins", 5400], ["1h, 15m", 4500],
    ["1.5h", 5400], ["120", 7200], ["45", 2700], ["  2H  ", 7200],
  ];
  for (const [text, sec] of cases) assert.equal(parseDuration(text), sec, text);
});

test("parseDuration refuses what it can't read", () => {
  for (const text of ["", "   ", "abc", "2 parsecs", "2:75", "h", "2h banana", "-30", "0", "0:00", "1:2:3", "two hours"]) {
    assert.equal(parseDuration(text), null, JSON.stringify(text));
  }
});

test("fmtDuration is the shortest natural form", () => {
  assert.equal(fmtDuration(7200), "2h");
  assert.equal(fmtDuration(9000), "2h 30m");
  assert.equal(fmtDuration(2700), "45m");
  assert.equal(fmtDuration(6300), "1h 45m");
  assert.equal(fmtDuration(0), "");
  assert.equal(fmtDuration(undefined), "");
});

test("describeDuration says it back in words; endsAt adds it to a start time", () => {
  assert.equal(describeDuration(9000), "2 hours 30 minutes");
  assert.equal(describeDuration(3600), "1 hour");
  assert.equal(describeDuration(60), "1 minute");
  assert.equal(describeDuration(2700), "45 minutes");
  assert.equal(endsAt("18:30", 9000), "9:00 PM");
  assert.equal(endsAt("11:00", 3600), "12:00 PM");
  assert.equal(endsAt("23:30", 3600), "12:30 AM");
});

test("setLengthOf reads seconds, falling back to legacy minutes", () => {
  assert.equal(setLengthOf({ setLengthSec: 5400 }), 5400);
  assert.equal(setLengthOf({ setLength: 90 }), 5400);
  assert.equal(setLengthOf({}), undefined);
});
