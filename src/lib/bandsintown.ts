import { kindOf, type ShowPlaceLike } from "./shows";

/** The checklist item Roadie adds to confirmed venue shows. */
export const BANDSINTOWN_ITEM_LABEL = "Add to Bandsintown";

/** Where an admin adds a show by hand (Bandsintown for Artists' new-event form). Null without the band's Bandsintown artist ID. */
export const bandsintownNewEventUrl = (artistId?: string | null) =>
  artistId ? `https://artists.bandsintown.com/artists/${encodeURIComponent(artistId)}/events/new?version=multi-step&step=type` : null;

/** Shows that belong on Bandsintown: confirmed, today or later, at a venue or a festival (never a house concert). */
export function bandsintownEligible(s: ShowPlaceLike & { status?: string; date: string; deletedAt?: unknown }, today: string): boolean {
  if (s.deletedAt || s.status !== "confirmed" || s.date < today) return false;
  const k = kindOf(s);
  return k === "venue" || k === "festival";
}
