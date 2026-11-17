/**
 * The seed's dates that have to stay ahead of today, as offsets from today in the seeded artist's timezone (Denver). A fixed date here
 * rots: the day it passes, its show leaves the Upcoming tab (confirmed -> played, hold -> dropped), its pitch date is no
 * longer offered to ask about, and every e2e spec that looks for it fails. Dates that are meant to be in the past
 * (the played show, the rehearsals, money) stay fixed in scripts/seed.ts: they never change sides.
 *
 * tests/e2e/dates.ts re-exports these with the labels the app shows for them. No spec writes one of these dates out.
 */
import { dateInZone } from "../src/lib/timezone";
import { addDays } from "../src/lib/shows";

/** Today in the seeded artist's timezone (Denver), read once: the seed and a spec that start either side of midnight still agree on the offsets' base only if they ran the same day, which a shard's run does (seed, then specs, minutes apart). */
export const SEED_TODAY = dateInZone("America/Denver"); // the seeded Nora Quill Band's zone
/** n days from today (the seeded artist's timezone), as YYYY-MM-DD. */
export const day = (n: number) => addDays(SEED_TODAY, n);

export const SEED_DATES = {
  /** The confirmed Deep End show. Two weeks out: never "today", so the day-of banner stays off. */
  deepEnd: day(14),
  /** The confirmed show at Marisol' Other Side and the Bluebird Room pitch date, on one day (the calendar's conflict). */
  conflict: day(28),
  /** The Pine Hollow Lounge hold, its ask, and the first live date on its pitch. */
  hold: day(63),
  /** The second live date on the Pine Hollow pitch. */
  holdAlt: day(70),
  /** The two dates on the Creamery Arts Center pitch, a week apart. */
  creamery1: day(118),
  creamery2: day(125),
} as const;
