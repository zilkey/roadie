/**
 * Personal touches (#82 S9): lines a booking email can borrow, from what the band already knows about the place. The compose
 * page lists them and inserts one at the end of the message only when asked: nothing goes in on its own.
 * Sources: our last shows at the venue, the shows on this pitch (from venue calendars), our take on the acts on those bills
 * (actNotes: "open for" acts and our note), and our own notes on the venue.
 */
import { fmtPitchDate } from "./booking";

export interface Touch { key: string; label: string; text: string }

export interface TouchInput {
  placeName: string;
  today: string;
  /** Our shows at this venue (any time): date and status. */
  shows: { id: string; date: string; status: string }[];
  /** Shows on this pitch, from the venue's calendar. */
  pitched: { id: string; date: string; acts: { name: string; role: string; actId?: string }[] }[];
  /** Our takes on acts, by act id. */
  actNotes: Map<string, { relationship?: string; note?: string }>;
  venueNote?: string;
}

const longDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export function personalTouches(i: TouchInput): Touch[] {
  const out: Touch[] = [];
  const played = i.shows.filter((s) => s.date < i.today && s.status !== "canceled" && s.status !== "dropped").sort((a, b) => b.date.localeCompare(a.date));
  if (played.length) {
    const last = played[0];
    out.push({ key: `played:${last.id}`, label: `We played here ${longDate(last.date)}${played.length > 1 ? ` (and ${played.length - 1} more time${played.length > 2 ? "s" : ""})` : ""}`,
      text: `We had a great time playing ${i.placeName} on ${longDate(last.date)}${played.length > 1 ? `, and we'd love to come back` : ""}.` });
  }
  for (const e of [...i.pitched].filter((e) => e.date >= i.today).sort((a, b) => a.date.localeCompare(b.date))) {
    const head = e.acts.find((a) => a.role === "headliner") ?? e.acts[0];
    if (!head) continue;
    out.push({ key: `show:${e.id}`, label: `On this pitch: ${head.name}, ${fmtPitchDate(e.date)}`, text: `We'd love to open for ${head.name} on ${fmtPitchDate(e.date)}.` });
    const take = head.actId ? i.actNotes.get(head.actId) : undefined;
    if (take?.relationship === "openFor") out.push({ key: `fan:${head.actId}`, label: `We'd love to open for ${head.name}`, text: `We're big fans of ${head.name}, and our sound would fit their crowd.` });
    if (take?.note?.trim()) out.push({ key: `actnote:${head.actId}`, label: `Our note on ${head.name}: ${take.note.trim()}`, text: take.note.trim() });
  }
  if (i.venueNote?.trim()) out.push({ key: "venueNote", label: `Our note on ${i.placeName}: ${i.venueNote.trim()}`, text: i.venueNote.trim() });
  return out;
}
