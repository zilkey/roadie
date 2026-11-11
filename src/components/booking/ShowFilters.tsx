"use client";
/**
 * The show filters Booking's Venue calendars tab and a venue's Events tab share: a dropdown of Likely needs an opener (the
 * default) or All shows, a Hide "not a fit" checkbox (on by default; admins only, since only they have takes), the main act's
 * genres (several at once) and When (All times, the default, 3 or 6 months out or more). They add up: a show is listed only when
 * it passes every one. Each list remembers its own per viewer on this device (localStorage, like the stage plot paper size).
 */
import { useEffect, useState } from "react";
import { clientAuth } from "@/lib/firebase-client";
import { CheckFilter } from "@/components/booking/CheckFilter";
import { CALENDAR_WHEN, DEFAULT_SHOW_FILTER, readShowFilter, SHOW_CHANCE, type CalendarWhen, type ShowChance, type ShowFilter } from "@/lib/venueEvents";

/** [filter, setFilter] for `name`: remembered per signed-in viewer on this device (read after mount, so the first render matches the server). */
export function useShowFilter<X extends object>(name: string, extra: X): [ShowFilter & X, (f: ShowFilter & X) => void] {
  const key = () => `${name}:${clientAuth().currentUser?.uid ?? "anon"}`;
  const [f, set] = useState<ShowFilter & X>({ ...DEFAULT_SHOW_FILTER, ...extra });
  useEffect(() => {
    try {
      const v = localStorage.getItem(key());
      if (v) { const o = JSON.parse(v); set({ ...extra, ...pickExtra(o, extra), ...readShowFilter(o) }); }
    } catch { /* nothing remembered */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [f, (v) => { set(v); try { localStorage.setItem(key(), JSON.stringify(v)); } catch { /* private mode: lasts for this page */ } }];
}
/** The remembered values of the list's own filters (a region), when they have the default's type. */
function pickExtra<X extends object>(o: Record<string, unknown>, extra: X): Partial<X> {
  return Object.fromEntries(Object.entries(extra).filter(([k, d]) => typeof o?.[k] === typeof d).map(([k]) => [k, o[k]])) as Partial<X>;
}

/** The filter row. `children` go before When (Venue calendars' region). Test ids: `${testid}-show`, `-hide`, `-genre`, `-when`. */
export function ShowFilterBar({ f, onChange, genres, canTake, testid, children }: {
  f: ShowFilter; onChange(patch: Partial<ShowFilter>): void; genres: { ours: string[]; rest: string[] }; canTake: boolean; testid: string; children?: React.ReactNode;
}) {
  const toOption = (g: string) => ({ key: g, label: g });
  return (
    <div className="filter-bar" role="group" aria-label="Filter shows" data-testid={testid}>
      <select className="select" value={f.show} onChange={(e) => onChange({ show: e.target.value as ShowChance })} aria-label="Which shows" data-testid={`${testid}-show`}>
        {SHOW_CHANCE.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <CheckFilter label="Main act's genre" all="Any genre" noun="genres" value={f.genres} onChange={(v) => onChange({ genres: v })} testid={`${testid}-genre`}
        groups={[{ label: genres.ours.length ? "Our genres" : undefined, options: genres.ours.map(toOption) }, { label: genres.ours.length ? "Other genres" : undefined, options: genres.rest.map(toOption) }]} />
      {children}
      <select className="select" value={f.when} onChange={(e) => onChange({ when: e.target.value as CalendarWhen })} aria-label="When" data-testid={`${testid}-when`}>
        {CALENDAR_WHEN.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {canTake && (
        <label className="check items-center text-sm">
          <input type="checkbox" checked={f.hideNotFit} onChange={(e) => onChange({ hideNotFit: e.target.checked })} data-testid={`${testid}-hide`} />
          <span>Hide &ldquo;not a fit&rdquo;</span>
        </label>
      )}
    </div>
  );
}
