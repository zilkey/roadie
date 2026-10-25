import type { SectionId } from "@/schema/sections";

/** SVG path data for the nav and menu icons. */
export const I = {
  shows: "M4 7h16v13H4zM4 11h16M8 3v4M16 3v4",
  calendar: "M3 5h18v16H3zM3 9h18M8 2v4M16 2v4M3 13h18M3 17h18M9 9v12M15 9v12",
  booking: "M6 3v18M6 4h12l-3 4 3 4H6",
  templates: "M4 5h16v14H4zM4 9h16M8 13h8M8 16h5",
  songs: "M9 18V6l10-2v12M9 18a3 3 0 11-3-3 3 3 0 013 3zm10-2a3 3 0 11-3-3 3 3 0 013 3z",
  setlists: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  rehearsals: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M10 17v-4l4-1v4M10 17a1.5 1.5 0 11-1.5-1.5M14 16a1.5 1.5 0 11-1.5-1.5",
  stagePlots: "M3 6h18v12H3zM3 14h18M8 10h.01M12 10h.01M16 10h.01",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  money: "M12 3v18M16 7.5c0-1.7-1.8-3-4-3s-4 1.1-4 3 1.8 2.6 4 3 4 1.3 4 3.2-1.8 3.3-4 3.3-4-1.3-4-3",
  fans: "M16 19v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 17.5V19M10 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM20 19v-1.5a3.5 3.5 0 00-2.5-3.35M15.5 4.2a3.5 3.5 0 010 6.6",
  chevron: "M6 9l6 6 6-6",
  back: "M15 5l-7 7 7 7",
  up: "M6 15l6-6 6 6",
};

export type NavItem = { key: "calendar" | SectionId; href: string; label: string; icon: string; /** A count badge (the Fans item: fans not yet in Bandzoogle). Set by the shell, never by navFor. */ badge?: number };

/** Every section this role can open, Calendar first, the rest in the person's own order. Fans is there only when the artist has turned `features.fans` on. */
export function navFor(role: "admin" | "member", order: SectionId[], opts: { fans?: boolean } = {}): NavItem[] {
  const all: Record<SectionId, NavItem> = {
    shows: { key: "shows", href: "/shows", label: "Shows", icon: I.shows },
    booking: { key: "booking", href: "/booking", label: "Booking", icon: I.booking },
    templates: { key: "templates", href: "/booking/templates", label: "Email templates", icon: I.templates },
    songs: { key: "songs", href: "/songs", label: "Songs", icon: I.songs },
    setlists: { key: "setlists", href: "/setlists", label: "Setlist Templates", icon: I.setlists },
    rehearsals: { key: "rehearsals", href: "/rehearsals", label: "Rehearsals", icon: I.rehearsals },
    stagePlots: { key: "stagePlots", href: "/stage-plots", label: "Stage plots", icon: I.stagePlots },
    money: { key: "money", href: "/money", label: role === "admin" ? "Money" : "My money", icon: I.money },
    fans: { key: "fans", href: "/fans", label: "Fans", icon: I.fans },
  };
  // Booking and its email templates are admin-only.
  const adminOnly = new Set<SectionId>(["booking", "templates"]);
  return [{ key: "calendar", href: "/calendar", label: "Calendar", icon: I.calendar }, ...order.filter((k) => (!adminOnly.has(k) || role === "admin") && (k !== "fans" || opts.fans)).map((k) => all[k])];
}
