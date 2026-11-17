// Quiet-days counting for pitches, in the artist's time zone (Denver here) (no emulator).
import { test } from "node:test";
import assert from "node:assert/strict";
import { QUIET_DAYS, quietDays } from "@/lib/booking";

test("quietDays counts calendar days in the artist's zone, only for Pitched and Talking", () => {
  const oct12Night = Date.parse("2026-10-13T05:30:00Z"); // 11:30pm Oct 12 in Denver
  assert.equal(quietDays("pitched", oct12Night, "2026-10-26", "America/Denver"), 14);
  assert.equal(quietDays("talking", oct12Night, "2026-10-25", "America/Denver"), 13);
  for (const s of ["idea", "toPitch", "booked", "declined", "dropped"]) assert.equal(quietDays(s, oct12Night, "2026-10-26", "America/Denver"), undefined);
  assert.equal(quietDays("pitched", undefined, "2026-10-26", "America/Denver"), undefined);
  assert.equal(QUIET_DAYS, 14);
});
