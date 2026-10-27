/** Pure helpers for the compose page (no browser or server imports). */
import { TEMPLATE_FIELDS } from "./booking";

/** What each template field fills in, in words. */
export const FIELD_WORDS: Record<string, string> = {
  "venue.name": "the venue's name", "venue.city": "its city", "promoter.name": "the promoter's name", "edition.name": "the festival year",
  "festival.name": "the festival's name", "target.name": "the place's name", "contact.name": "their name", "contact.firstName": "their first name",
  "artist.name": "the band's name", "artist.video": "your video link", "pitch.configuration": "the lineup you're pitching",
  "user.name": "your name", "user.firstName": "your first name", "stats.monthlyListeners": "your monthly listeners", "stats.followers": "your followers",
};

/** "a", "a and b", "a, b and c". */
export const joinWords = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The words for the fields a template uses ("their first name, the venue's name and your name"), "" when it uses none. */
export function fieldsInWords(...texts: string[]): string {
  const text = texts.join("\n");
  const used = TEMPLATE_FIELDS.filter((f) => new RegExp(`\\{\\{\\s*${f.replace(".", "\\.")}\\s*\\}\\}`).test(text));
  return joinWords([...new Set(used.map((f) => FIELD_WORDS[f] ?? f))]);
}

/** A first guess at a person's name from an address: "lost.lake_booking@x.com" -> "Lost Lake Booking". */
export function nameFromAddress(address: string): string {
  const local = address.split("@")[0].replace(/\+.*$/, "");
  return local.split(/[._\-\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/** "venue:abc" -> {kind, id}; null for anything else. */
export function parseTarget(v: string | null): { kind: "venue" | "promoter" | "festival" | "edition"; id: string } | null {
  const m = /^(venue|promoter|festival|edition):(.+)$/.exec(v ?? "");
  return m ? { kind: m[1] as "venue", id: m[2] } : null;
}
