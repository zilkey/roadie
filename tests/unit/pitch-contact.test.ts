// Quiet-days counting for pitches, in the band time zone (no emulator).
import { test } from "node:test";
import assert from "node:assert/strict";
import { QUIET_DAYS, quietDays } from "@/lib/booking";

test("quietDays counts band-timezone calendar days, only for Pitched and Talking", () => {
  const oct12Night = Date.parse("2026-10-13T05:30:00Z"); // 11:30pm Oct 12 in Denver
  assert.equal(quietDays("pitched", oct12Night, "2026-10-26"), 14);
  assert.equal(quietDays("talking", oct12Night, "2026-10-25"), 13);
  for (const s of ["idea", "toPitch", "booked", "declined", "dropped"]) assert.equal(quietDays(s, oct12Night, "2026-10-26"), undefined);
  assert.equal(quietDays("pitched", undefined, "2026-10-26"), undefined);
  assert.equal(QUIET_DAYS, 14);
});
