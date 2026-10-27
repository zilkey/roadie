/** Lowercase, strip accents/punctuation, hyphenate. */
export function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const lowerEmail = (s: string) => s.trim().toLowerCase();

/** Normalize to E.164 for US numbers; leaves already-+ numbers alone. */
export function e164(s: string): string {
  const d = s.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d;
}

export type MatchDoc = Record<string, unknown>;

/** matchKey per collection. Returns undefined for collections without one. */
export function matchKeyFor(collection: string, d: MatchDoc): string | undefined {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (collection) {
    case "contacts": {
      const emails = Array.isArray(d.emails) ? (d.emails as string[]) : [];
      return emails[0] ? lowerEmail(emails[0]) : slug(str(d.name));
    }
    case "venues": {
      const addr = (d.address ?? {}) as Record<string, unknown>;
      return `${slug(str(d.name))}-${slug(str(addr.city))}`;
    }
    case "promoters":
    case "festivals":
      return slug(str(d.name));
    case "venueTypes":
      return slug(str(d.label));
    default:
      return undefined;
  }
}
