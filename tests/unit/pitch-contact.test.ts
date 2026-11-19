// Quiet-days counting for pitches, in the artist's time zone (Denver here) (no emulator).
import { test } from "node:test";
import assert from "node:assert/strict";
import { QUIET_DAYS, quietDays, goneQuiet, followUpFor } from "@/lib/booking";

test("quietDays counts calendar days in the artist's zone, only for Pitched and Talking", () => {
  const oct12Night = Date.parse("2026-10-13T05:30:00Z"); // 11:30pm Oct 12 in Denver
  assert.equal(quietDays("pitched", oct12Night, "2026-10-26", "America/Denver"), 14);
  assert.equal(quietDays("talking", oct12Night, "2026-10-25", "America/Denver"), 13);
  for (const s of ["idea", "toPitch", "booked", "declined", "dropped"]) assert.equal(quietDays(s, oct12Night, "2026-10-26", "America/Denver"), undefined);
  assert.equal(quietDays("pitched", undefined, "2026-10-26", "America/Denver"), undefined);
  assert.equal(QUIET_DAYS, 14);
});

test("a next step due ahead keeps a long-quiet pitch from going yellow; a due or past one doesn't", () => {
  const oct23 = { toMillis: () => Date.parse("2026-10-23T20:41:24Z") };
  const base = { status: "pitched", lastContactAt: oct23 };
  const z = "America/Denver", today = "2026-11-18";
  assert.equal(goneQuiet(base, today, z), true);
  assert.equal(goneQuiet({ ...base, nextStep: { text: "follow-up", due: "2026-12-02" } }, today, z), false);
  assert.equal(followUpFor({ ...base, nextStep: { text: "follow-up", due: "2026-12-02" } }, today, z), null);
  assert.equal(goneQuiet({ ...base, nextStep: { text: "follow-up", due: today } }, today, z), true);
  assert.equal(goneQuiet({ ...base, nextStep: { text: "follow-up" } }, today, z), true);
});
