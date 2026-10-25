"use client";
import { usePathname } from "next/navigation";
import { Link, useArtist, useHref } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import type { Musician } from "@/schema";

const HEAD = "px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-muted";
const GROUPS = [
  { head: "Artist settings", items: [{ key: "general", href: "/admin/artist", label: "General" }, { key: "lineups", href: "/admin/lineups", label: "Lineups" }, { key: "people", href: "/admin/people", label: "People" }] },
  { head: "Admin", items: [{ key: "integrations", href: "/admin/mcp", label: "Integrations" }, { key: "activity", href: "/admin/history", label: "Activity" }] },
] as const;

/** The artist-settings sub-nav: General, Lineups, People under ARTIST SETTINGS; Integrations, Activity under ADMIN. Counts show once loaded. */
export function SettingsNav() {
  const path = usePathname();
  const full = useHref();
  const { doc } = useArtist();
  const musicians = useCollection<Musician>("musicians");
  const counts: Record<string, number | undefined> = {
    lineups: doc?.configurations.length,
    people: musicians.rows?.filter((m) => m.active).length,
  };
  const on = (href: string) => path === full(href) || path.startsWith(full(href) + "/");
  return (
    <nav aria-label="Artist settings" data-testid="settings-nav" className="flex-[1_1_220px] self-start rounded-lg border border-border bg-surface p-2">
      {GROUPS.map((g) => (
        <div key={g.head}>
          <div className={HEAD}>{g.head}</div>
          {g.items.map((i) => (
            <Link key={i.key} href={i.href} data-testid={`settings-nav-${i.key}`} aria-current={on(i.href) ? "page" : undefined} className={`menu-item${on(i.href) ? " bg-accent-soft text-accent" : ""}`}>
              {i.label}{counts[i.key] !== undefined && <span className="s ml-auto">{counts[i.key]}</span>}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
