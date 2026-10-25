import type { SectionId } from "@/schema/sections";

/** SVG path data for the nav and menu icons. */
export const I = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  shows: "M4 7h16v13H4zM4 11h16M8 3v4M16 3v4",
  booking: "M6 3v18M6 4h12l-3 4 3 4H6",
  templates: "M4 5h16v14H4zM4 9h16M8 13h8M8 16h5",
  songs: "M9 18V6l10-2v12M9 18a3 3 0 11-3-3 3 3 0 013 3zm10-2a3 3 0 11-3-3 3 3 0 013 3z",
  setlists: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  rehearsals: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M10 17v-4l4-1v4M10 17a1.5 1.5 0 11-1.5-1.5M14 16a1.5 1.5 0 11-1.5-1.5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  money: "M12 3v18M16 7.5c0-1.7-1.8-3-4-3s-4 1.1-4 3 1.8 2.6 4 3 4 1.3 4 3.2-1.8 3.3-4 3.3-4-1.3-4-3",
  chevron: "M6 9l6 6 6-6",
  back: "M15 5l-7 7 7 7",
  up: "M6 15l6-6 6 6",
};

export type NavItem = { key: "home" | SectionId; href: string; label: string; icon: string };

/** Every section this role can open, Home first, the rest in the person's own order. */
export function navFor(role: "admin" | "member", order: SectionId[]): NavItem[] {
  const all: Record<SectionId, NavItem> = {
    shows: { key: "shows", href: "/shows", label: "Shows", icon: I.shows },
    booking: { key: "booking", href: "/booking", label: "Booking", icon: I.booking },
    templates: { key: "templates", href: "/booking/templates", label: "Email templates", icon: I.templates },
    songs: { key: "songs", href: "/songs", label: "Songs", icon: I.songs },
    setlists: { key: "setlists", href: "/setlists", label: "Setlist Templates", icon: I.setlists },
    rehearsals: { key: "rehearsals", href: "/rehearsals", label: "Rehearsals", icon: I.rehearsals },
    money: { key: "money", href: "/money", label: role === "admin" ? "Money" : "My money", icon: I.money },
  };
  // Booking and its email templates are admin-only.
  const adminOnly = new Set<SectionId>(["booking", "templates"]);
  return [{ key: "home", href: "/home", label: "Home", icon: I.home }, ...order.filter((k) => !adminOnly.has(k) || role === "admin").map((k) => all[k])];
}
