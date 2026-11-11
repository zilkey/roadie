"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useMaybeArtist } from "./artist";
import { runCommand } from "./commands";

/** Result shapes of the fans.* commands (src/server/commands/fans.ts). */
export interface FanRow {
  id: string; email: string; firstName: string | null; cities: { city: string; state?: string }[]; showIds: string[];
  source: "list" | "paper"; addedAt: string | null; lastSeenAt: string | null; bandzoogle: { addedAt: string | null; group: string } | null;
}
export interface FanCounts {
  total: number; byCity: Record<string, number>; byShow: { showId: string; label: string; count: number }[]; notInBandzoogle: number;
}
export interface BandzoogleGroup { group: string; count: number; ids: string[]; emails: string[]; csv: string }

/** Is the fans module on for the open artist? (`features.fans` on the artist document; missing = off.) */
export function useFansOn(): boolean {
  return !!useMaybeArtist()?.doc?.features?.fans;
}

/** Anything that changes who is on the list or in Bandzoogle says so, and the nav badge and the show banners reload. */
export const FANS_CHANGED = "fans:changed";
export const announceFansChanged = () => window.dispatchEvent(new Event(FANS_CHANGED));

/** Reload a fans.* read when the list changes, the window comes back into focus, or `deps` change. */
function useFansRead<T>(name: string, input: unknown, enabled: boolean, pick: (r: never) => T, initial: T): T {
  const [v, setV] = useState<T>(initial);
  const key = JSON.stringify(input);
  const path = usePathname();
  useEffect(() => {
    if (!enabled) { setV(initial); return; }
    let live = true;
    const load = () => { runCommand(name, JSON.parse(key)).then((r) => { if (live) setV(pick(r as never)); }).catch(() => {}); };
    load();
    window.addEventListener(FANS_CHANGED, load); window.addEventListener("focus", load);
    return () => { live = false; window.removeEventListener(FANS_CHANGED, load); window.removeEventListener("focus", load); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, name, key, path]);
  return v;
}

/** Fans not yet in Bandzoogle, for the nav badge (admins only). 0 while loading, off, or for members. */
export function useFansBadge(): number {
  const artist = useMaybeArtist();
  const on = useFansOn() && artist?.role === "admin";
  return useFansRead<number>("fans.newSince", {}, on, (r: { notInBandzoogle: number }) => r.notInBandzoogle, 0);
}

/** Fans from one show, for the show page's banner. null until known; shown to members as a count too. */
export function useShowFans(showId: string): { label: string; added: number; notInBandzoogle: number } | null {
  const on = useFansOn();
  return useFansRead<{ label: string; added: number; notInBandzoogle: number } | null>(
    "fans.newSince", { showId }, on, (r: { label: string; added: number; notInBandzoogle: number }) => r, null);
}

/** Counts by city and show: everyone in the band may read these. */
export function useFanCounts(): FanCounts | null {
  const on = useFansOn();
  return useFansRead<FanCounts | null>("fans.counts", {}, on, (r: FanCounts) => r, null);
}

/** The fans themselves (admins only: members never ask). */
export function useFanList(enabled: boolean): FanRow[] | null {
  const on = useFansOn() && enabled;
  return useFansRead<FanRow[] | null>("fans.list", { limit: 1000 }, on, (r: { fans: FanRow[] }) => r.fans, null);
}
