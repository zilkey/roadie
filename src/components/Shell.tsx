"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth, useProfile } from "@/lib/auth";
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

export const ADMIN_LINKS = [
  { href: "/admin/users", label: "Users", testid: "admin-users" },
  { href: "/admin/musicians", label: "Musicians", testid: "admin-musicians" },
  { href: "/admin/artist", label: "Artist & gear", testid: "admin-artist" },
  { href: "/admin/ai-keys", label: "AI keys", testid: "admin-ai-keys" },
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
  const path = usePathname();
  const { hidden } = useHiddenSections();
  const { main: items, more } = splitNav(navFor(profile.role), hidden);
  const on = (href: string) => path === href || path.startsWith(href + "/");
  // More opens by itself while you are on one of its pages; `sheet` is the phone's version.
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const inMore = more.some((n) => on(n.href));

  return (
    <div className="min-h-dvh md:flex">
      {profile.role === "admin" && <Roadie />}
      <aside className="hidden w-60 shrink-0 flex-col gap-1 border-r border-line bg-panel p-4 md:flex" data-testid="sidebar">
        <div className="font-display mb-3 text-xl font-extrabold">Band Tracker</div>
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
            <span className="lbl px-3">People</span>
            {ADMIN_LINKS.map((l) => (
              <Link key={l.href} href={l.href} data-testid={`side-${l.testid}`} className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${on(l.href) ? "bg-accent-soft text-accent" : "hover:bg-soft"}`}>{l.label}</Link>
            ))}
          </div>
        )}
        <div className="mt-auto grid gap-2 border-t border-line pt-3">
          <span className="s" data-testid="whoami">{profile.name} · {profile.role}</span>
          <button className="btn ghost sm" data-testid="signout" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-panel px-4 py-3 md:hidden">
          <span className="font-display text-lg font-extrabold">Band Tracker</span>
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
