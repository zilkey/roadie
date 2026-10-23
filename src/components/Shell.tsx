"use client";
import Link from "@/lib/artist";
import { usePathname } from "next/navigation";
import { useState } from "react";
import NextLink from "next/link";
import { useAuth, useProfile } from "@/lib/auth";
import { useArtist, useHref } from "@/lib/artist";
import { ARTISTS_PATH } from "@/lib/routes";
import { Roadie } from "@/components/roadie/Roadie";
import { setSectionHidden, useHiddenSections } from "@/lib/sections";
import { isSectionId, type SectionId } from "@/schema/sections";
import { toast } from "@/components/Toasts";

const I = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  shows: "M4 7h16v13H4zM4 11h16M8 3v4M16 3v4",
  booking: "M6 3v18M6 4h12l-3 4 3 4H6",
  songs: "M9 18V6l10-2v12M9 18a3 3 0 11-3-3 3 3 0 013 3zm10-2a3 3 0 11-3-3 3 3 0 013 3z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  money: "M12 3v18M16 7.5c0-1.7-1.8-3-4-3s-4 1.1-4 3 1.8 2.6 4 3 4 1.3 4 3.2-1.8 3.3-4 3.3-4-1.3-4-3",
};
function Icon({ d }: { d: string }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

export function navFor(role: "admin" | "member") {
  return [
    { key: "home", href: "/home", label: "Home", icon: I.home },
    ...(role === "admin" ? [{ key: "booking", href: "/booking", label: "Booking", icon: I.booking }] : []),
    { key: "shows", href: "/shows", label: "Shows", icon: I.shows },
    { key: "songs", href: "/songs", label: "Songs", icon: I.songs },
    { key: "money", href: "/money", label: role === "admin" ? "Money" : "My money", icon: I.money },
  ];
}
/** The sections a person can hide (Home never is) split into what stays in the main nav and what lives under More. */
export function splitNav<T extends { key: string }>(items: T[], hidden: SectionId[]) {
  const away = (n: T) => isSectionId(n.key) && hidden.includes(n.key);
  return { main: items.filter((n) => !away(n)), more: items.filter(away) };
}
async function showAgain(n: { key: string; label: string }) {
  try { await setSectionHidden(n.key as SectionId, false); toast({ key: `hide:${n.key}`, text: `${n.label} is back in the menu.` }); }
  catch (e) { toast({ key: `hide:${n.key}`, text: `Couldn't bring back ${n.label}: ${e instanceof Error ? e.message : "error"}`, ms: 6000 }); }
}

/** Settings links (artist-relative). Artist comes first: it is what the rest hang off. */
export const ADMIN_LINKS = [
  { href: "/admin/artist", label: "Artist", testid: "admin-artist" },
  { href: "/admin/people", label: "People", testid: "admin-people" },
  { href: "/admin/mcp", label: "Claude Code", testid: "admin-mcp" },
  { href: "/admin/history", label: "History", testid: "admin-history" },
];

/** A hidden section under More: its page still works; "Show" puts it back in the main nav. */
function MoreRow({ n, on, onGo }: { n: { key: string; href: string; label: string; icon: string }; on: boolean; onGo?: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <Link href={n.href} onClick={onGo} data-testid={`more-${n.key}`} aria-current={on ? "page" : undefined}
        className={`flex flex-1 items-center gap-3 rounded-xl px-3 py-1.5 text-sm font-semibold ${on ? "bg-accent-soft text-accent" : "hover:bg-soft"}`}><Icon d={n.icon} />{n.label}</Link>
      <button type="button" className="btn ghost sm" data-testid={`show-${n.key}`} onClick={() => showAgain(n)}>Show</button>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const profile = useProfile();
  const { signOut } = useAuth();
  const artist = useArtist();
  const full = useHref();
  const path = usePathname();
  const { hidden } = useHiddenSections();
  const { main: items, more } = splitNav(navFor(profile.role), hidden);
  const on = (href: string) => path === full(href) || path.startsWith(full(href) + "/");
  const several = profile.artists.length > 1;
  // More opens by itself while you are on one of its pages; `sheet` is the phone's version.
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const inMore = more.some((n) => on(n.href));
  const inSettings = ADMIN_LINKS.some((l) => on(l.href));

  return (
    <div className="min-h-dvh md:flex">
      {profile.role === "admin" && <Roadie />}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-panel p-4 md:flex" data-testid="sidebar">
        <div className="font-display text-xl font-extrabold">Band Tracker</div>
        <div className="mb-3 flex items-center justify-between gap-2 text-sm">
          <span className="truncate font-semibold" data-testid="current-artist">{artist.name}</span>
          {several && <NextLink href={ARTISTS_PATH} className="s shrink-0 underline" data-testid="switch-artist">Switch</NextLink>}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {items.map((n) => (
            <Link key={n.key} href={n.href} data-testid={`tab-${n.key}`} aria-current={on(n.href) ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 font-semibold ${on(n.href) ? "bg-accent-soft text-accent" : "text-ink hover:bg-soft"}`}>
              <Icon d={n.icon} />{n.label}
            </Link>
          ))}
          {more.length > 0 && (
            <div className="mt-2 grid gap-1" data-testid="more-group">
              <button type="button" className="flex items-center justify-between rounded-xl px-3 py-1.5 text-sm font-semibold text-muted hover:bg-soft" data-testid="more-toggle"
                aria-expanded={moreOpen || inMore} onClick={() => setMoreOpen(!moreOpen)}>More<span aria-hidden>{moreOpen || inMore ? "−" : "+"}</span></button>
              {(moreOpen || inMore) && more.map((n) => <MoreRow key={n.key} n={n} on={on(n.href)} />)}
            </div>
          )}
          {profile.role === "admin" && (
            <div className="mt-4 grid gap-1">
              <button type="button" data-testid="settings-toggle" aria-expanded={settingsOpen || inSettings}
                onClick={() => setSettingsOpen(!settingsOpen)}
                className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-semibold ${inSettings ? "text-accent" : "text-muted"} hover:bg-soft`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
                Settings
                <span aria-hidden className="ml-auto">{settingsOpen || inSettings ? "−" : "+"}</span>
              </button>
              {(settingsOpen || inSettings) && ADMIN_LINKS.map((l) => (
                <Link key={l.href} href={l.href} data-testid={`side-${l.testid}`} className={`rounded-xl px-3 py-1.5 pl-8 text-sm font-semibold ${on(l.href) ? "bg-accent-soft text-accent" : "hover:bg-soft"}`}>{l.label}</Link>
              ))}
            </div>
          )}
        </div>
        <div className="mt-3 grid gap-2 border-t border-line pt-3">
          <span className="s" data-testid="whoami">{profile.name} · {profile.role}</span>
          <button className="btn ghost sm" data-testid="signout" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-panel px-4 py-3 md:hidden">
          <span className="grid">
            <span className="font-display text-lg font-extrabold">Band Tracker</span>
            {several ? <NextLink href={ARTISTS_PATH} className="s underline" data-testid="switch-artist-mobile">{artist.name}</NextLink> : <span className="s">{artist.name}</span>}
          </span>
          <span className="flex items-center gap-2">
            <span className="s">{profile.name}</span>
            <button className="btn ghost sm" data-testid="signout-mobile" onClick={signOut}>Sign out</button>
          </span>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-5 md:pb-10">{children}</main>
        <nav className="fixed inset-x-0 bottom-0 z-10 grid border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] md:hidden"
          style={{ gridTemplateColumns: `repeat(${items.length + (more.length ? 1 : 0)}, 1fr)` }} data-testid="bottom-tabs">
          {items.map((n) => (
            <Link key={n.key} href={n.href} data-testid={`mtab-${n.key}`} aria-current={on(n.href) ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 py-2 text-xs font-semibold ${on(n.href) ? "text-accent" : "text-muted"}`}>
              <Icon d={n.icon} />{n.label}
            </Link>
          ))}
          {more.length > 0 && (
            <button type="button" data-testid="mtab-more" aria-expanded={sheet} onClick={() => setSheet(!sheet)}
              className={`flex flex-col items-center gap-0.5 py-2 text-xs font-semibold ${inMore || sheet ? "text-accent" : "text-muted"}`}>
              <Icon d={I.more} />More
            </button>
          )}
        </nav>
        {sheet && more.length > 0 && (
          <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 grid gap-1 border-t border-line bg-panel p-3 shadow-lg md:hidden" data-testid="more-sheet">
            {more.map((n) => <MoreRow key={n.key} n={n} on={on(n.href)} onGo={() => setSheet(false)} />)}
          </div>
        )}
      </div>
    </div>
  );
}
