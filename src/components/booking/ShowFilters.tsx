"use client";
/**
 * The show filters Booking's Venue calendars tab and a venue's Events tab share: a menu of Likely needs an opener (the default)
 * or All shows, the main act's genres (several at once), When (All times, the default, 3 or 6 months out or more), and Hide
 * Flagged (off by default) and Hide Not a fit (on by default), admins only since only they have flags and takes. They add up: a show is listed only when
 * it passes every one. A venue's Events tab remembers its own per viewer on this device (localStorage); Venue calendars keeps
 * them in the URL (showFilterToParams).
 */
import { useEffect, useState } from "react";
import { clientAuth } from "@/lib/firebase-client";
import { CheckFilter } from "@/components/booking/CheckFilter";
import { FlagIcon } from "@/components/booking/common";
import { XIcon } from "@/components/booking/ActsTab";
import { CALENDAR_WHEN, DEFAULT_SHOW_FILTER, readShowFilter, SHOW_CHANCE, type CalendarWhen, type ShowChance, type ShowFilter } from "@/lib/venueEvents";

/** [filter, setFilter] for `name`: remembered per signed-in viewer on this device (read after mount, so the first render matches the server). */
export function useShowFilter<X extends object>(name: string, extra: X, base: ShowFilter = DEFAULT_SHOW_FILTER): [ShowFilter & X, (f: ShowFilter & X) => void] {
  const key = () => `${name}:${clientAuth().currentUser?.uid ?? "anon"}`;
  const [f, set] = useState<ShowFilter & X>({ ...base, ...extra });
  useEffect(() => {
    try {
      const v = localStorage.getItem(key());
      if (v) { const o = JSON.parse(v); set({ ...extra, ...pickExtra(o, extra), ...readShowFilter(o, base) }); }
    } catch { /* nothing remembered */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [f, (v) => { set(v); try { localStorage.setItem(key(), JSON.stringify(v)); } catch { /* private mode: lasts for this page */ } }];
}
/** The remembered values of the list's own filters (a region), when they have the default's type. */
function pickExtra<X extends object>(o: Record<string, unknown>, extra: X): Partial<X> {
  return Object.fromEntries(Object.entries(extra).filter(([k, d]) => typeof o?.[k] === typeof d).map(([k]) => [k, o[k]])) as Partial<X>;
}

/**
 * The filter row, one quiet line of pill menus: which shows, genre, `children` (Venue calendars' region), When. Then "Hide" with two
 * toggle chips, Flagged (shows on an open pitch) and Not a fit, admins only since only they flag and take; then `trailing` at the
 * far end (Venue calendars' "New flags go to", which isn't a filter). A menu off its default is tinted, so a changed filter stands
 * out. Test ids: `${testid}-show`, `-genre`, `-when`, `-hide` (not a fit), `-hide-flagged`.
 */
export function ShowFilterBar({ f, onChange, genres, canTake, testid, children, trailing, defaults = DEFAULT_SHOW_FILTER }: {
  f: ShowFilter; onChange(patch: Partial<ShowFilter>): void; genres: { ours: string[]; rest: string[] }; canTake: boolean; testid: string;
  /** What "off its default" means for the tint: one venue's tab defaults to every show. */
  defaults?: ShowFilter;
  children?: React.ReactNode; trailing?: React.ReactNode;
}) {
  const toOption = (g: string) => ({ key: g, label: g });
  return (
    <div className="filter-bar show-filters" role="group" aria-label="Filter shows" data-testid={testid}>
      <select className="select" value={f.show} onChange={(e) => onChange({ show: e.target.value as ShowChance })} aria-label="Which shows"
        data-on={f.show !== defaults.show ? "1" : undefined} data-testid={`${testid}-show`}>
        {SHOW_CHANCE.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <CheckFilter label="Main act's genre" all="Any genre" noun="genres" value={f.genres} onChange={(v) => onChange({ genres: v })} testid={`${testid}-genre`}
        groups={[{ label: genres.ours.length ? "Our genres" : undefined, options: genres.ours.map(toOption) }, { label: genres.ours.length ? "Other genres" : undefined, options: genres.rest.map(toOption) }]} />
      {children}
      <select className="select" value={f.when} onChange={(e) => onChange({ when: e.target.value as CalendarWhen })} aria-label="When"
        data-on={f.when !== defaults.when ? "1" : undefined} data-testid={`${testid}-when`}>
        {CALENDAR_WHEN.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {canTake && (
        <span className="hide-group" role="group" aria-label="Hide">
          <span className="hide-label">Hide</span>
          <label className="hide-chip flagged" title="Hide shows already on a pitch (a filled flag)">
            <input type="checkbox" checked={f.hideFlagged} onChange={(e) => onChange({ hideFlagged: e.target.checked })} data-testid={`${testid}-hide-flagged`} />
            <FlagIcon filled={f.hideFlagged} /><span>Flagged</span>
          </label>
          <label className="hide-chip not-fit" title="Hide shows marked Not a fit">
            <input type="checkbox" checked={f.hideNotFit} onChange={(e) => onChange({ hideNotFit: e.target.checked })} data-testid={`${testid}-hide`} />
            <XIcon size={13} /><span>Not a fit</span>
          </label>
        </span>
      )}
      {trailing && <span className="filter-end">{trailing}</span>}
    </div>
  );
}
