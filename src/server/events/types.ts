import type { Act, VenueCalendar } from "@/schema";
import type { Net } from "./fetch";

/**
 * What a reader returns: one row per event as the source lists it. Give either `date` (+ `start`/`doors`, venue-local wall clock),
 * `startsAt` (an ISO instant or a local "YYYY-MM-DDTHH:MM[:SS]" without an offset; dates.ts turns it into the venue's date and
 * time), or `dateText` (free text like "Fri, Nov 14 · 8pm": dates.ts parses it). The shared post-step (bill.ts, refresh.ts)
 * splits the title into acts when the reader gives none, drops non-music, applies the calendar's filter and upserts.
 */
export interface RawEvent {
  /** The source's own id (event id, uid, url). Falls back to ticketUrl, then date + title. */
  sourceId?: string;
  title: string;
  date?: string;
  start?: string;
  doors?: string;
  startsAt?: string;
  dateText?: string;
  /** Text of the time alone ("8:00 PM"), when a page has it apart from the date. */
  timeText?: string;
  doorsText?: string;
  /** Acts the source names itself (AEG, Plot, venue.network). Absent: the post-step splits the title. */
  acts?: Act[];
  imageUrl?: string;
  ticketUrl?: string;
  status?: "onsale" | "soldout" | "cancelled";
  /** The room's name on a page that lists several rooms, for filter.venueName. */
  venueName?: string;
  /** Categories or tags, for telling music from trivia. */
  tags?: string[];
  description?: string;
}

export interface ReaderCtx {
  net: Net;
  /** The venue's IANA time zone (America/Denver when the venue has none). */
  tz: string;
  now: Date;
}

/** How much of the bill a source shows, by default; a reader may say better. */
export type BillDetail = "full" | "headliner" | "title";

export interface ReaderResult { events: RawEvent[]; bill: BillDetail; /** Hint for parsing dateText (selectors). */ dateFormat?: string }

export type Reader<T extends VenueCalendar["type"] = VenueCalendar["type"]> =
  (cal: Extract<VenueCalendar, { type: T }>, ctx: ReaderCtx) => Promise<ReaderResult>;
