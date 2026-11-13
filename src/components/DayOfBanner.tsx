"use client";
import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import Link, { useArtist } from "@/lib/artist";
import { useAuth } from "@/lib/auth";
import { clientDb } from "@/lib/firebase-client";
import { useCollection, useDocs } from "@/lib/firestore-hooks";
import { runCommand } from "@/lib/commands";
import { dateInBandZone } from "@/lib/timezone";
import { dayOfAfter, dayOfAsk, dayOfCongrats, dayOfDates, dayOfDirectionsHref, dayOfDismissLabel, dayOfItems, dayOfText, type DayOfItem, type DayOfRehearsal, type DayOfShow } from "@/lib/dayOf";
import { askRoadie } from "@/components/roadie/ask";
import { toast } from "@/components/Toasts";
import { fanPreviewHref } from "@/components/shows/page/FanPageCard";
import type { Venue } from "@/schema";

const linkClass = "flex min-h-11 min-w-0 flex-1 items-center gap-2 pl-4 pr-1 text-sm no-underline hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white min-[900px]:gap-2.5 min-[900px]:pl-5 min-[900px]:text-[0.9375rem]";

/** Each piece of a row is its own link: the pill, title, time and city open the page; Directions and the fan page links go where they say. */
const partClass = "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap no-underline hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white";

/** The clock the banner runs on: now, refreshed every half minute and when the tab comes back, so rows appear, change and leave by themselves. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const t = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, []);
  return now;
}

/** The rows the signed-in person hid in this artist (userPrefs/{uid}.dayOfDismissed[artistId]; owner-only read), live. */
function useDismissed(artistId: string): string[] {
  const { state } = useAuth();
  const uid = state.status === "ready" ? state.profile.uid : null;
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(clientDb(), "userPrefs", uid), (s) => {
      const v = s.data()?.dayOfDismissed?.[artistId];
      setKeys(Array.isArray(v) ? v : []);
    }, () => undefined);
  }, [uid, artistId]);
  return keys;
}

/**
 * The day-of banner (#66): a row above the nav for each of today's confirmed shows and rehearsals, from 3 hours before its
 * first time until it is over (src/lib/dayOf.ts), for everyone in the band. A row links to the show or rehearsal and says the
 * next time still ahead, with Directions (Google Maps) when it has a place and, for admins on a show, Preview Fan Page (once the
 * line has an amount) and Edit Fan Page (the show's Promotion tab), those two from 900px up so a phone row stays one line; its × hides it for you only (command dayOf.dismiss). Renders nothing when there is nothing on.
 * An hour after a show's last time its row says "Congrats on the Deep End show!"; for admins it adds "Record the deets", and a
 * tap opens the show and asks Roadie (in a new chat, about that show) to start the after-show interview.
 */
export function DayOfBanner() {
  const { artistId, role, doc: artist } = useArtist();
  const slug = artist?.slug;
  const admin = role === "admin";
  const now = useNow();
  const today = dateInBandZone(new Date(now));
  const dates = useMemo(() => dayOfDates(today), [today]);
  const shows = useCollection<DayOfShow>("shows", { where: [["date", "in", dates]] });
  const rehearsals = useCollection<DayOfRehearsal>("rehearsals", { where: [["date", "in", dates]] });
  const mine = useMemo(() => (shows.rows ?? []).filter((s) => s.status === "confirmed" && s.artistId === artistId), [shows.rows, artistId]);
  // A venue's time zone is on the shared venue record, not on the show's copy of it.
  const venues = useDocs<Venue>("venues", mine.flatMap((s) => (s.venue ? [s.venue.id] : [])));
  const stored = useDismissed(artistId);
  const [hiding, setHiding] = useState<string[]>([]);

  const items = useMemo(() => {
    const zones = new Map(venues.rows.map((v) => [v.id, v.timeZone]));
    // Until a show's venue has loaded its time zone is unknown: leave it out rather than show it on the wrong clock.
    const ready = mine.filter((s) => !s.venue || !venues.loading || zones.has(s.venue.id));
    return dayOfItems({ shows: ready, rehearsals: rehearsals.rows ?? [], now, artistId, zones, dismissed: [...stored, ...hiding] });
  }, [mine, rehearsals.rows, venues.rows, venues.loading, now, artistId, stored, hiding]);

  async function hide(item: DayOfItem) {
    setHiding((h) => [...h, item.key]);
    try {
      await runCommand("dayOf.dismiss", { kind: item.kind, id: item.id });
    } catch (e) {
      setHiding((h) => h.filter((k) => k !== item.key));
      toast({ key: "dayof", text: `Couldn't hide the banner: ${e instanceof Error ? e.message : "error"}`, ms: 6000 });
    }
  }

  if (!items.length) return null;
  return (
    <section className="shrink-0 bg-[var(--accent)] pt-[env(safe-area-inset-top)] text-[var(--on-accent)] print:hidden" aria-label="On today" data-testid="dayof-banner">
      {items.map((item, i) => (
        <div key={item.key} className={`flex min-h-11 items-center${i ? " shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]" : ""}`} data-testid={`dayof-row-${item.kind}`} data-key={item.key}>
          {dayOfAfter(item, now) ? (
            <Link href={item.href} data-testid="dayof-link" data-after=""
              onClick={admin ? () => askRoadie({ text: dayOfAsk(item), pageContext: { route: "show", recordKind: "show", recordId: item.id } }) : undefined}
              className={linkClass}>
              <span className="min-w-0 truncate font-bold" data-testid="dayof-congrats">{dayOfCongrats(item)}</span>
              {admin && <span className="shrink-0 whitespace-nowrap underline" data-testid="dayof-record">Record the deets</span>}
            </Link>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-x-3 overflow-hidden pl-4 text-sm min-[900px]:gap-x-4 min-[900px]:pl-5 min-[900px]:text-[0.9375rem]">
              <Link href={item.href} data-testid="dayof-link" className={partClass}>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide">{item.kind === "show" ? "Show" : "Rehearsal"}</span>
              </Link>
              {item.title && <Link href={item.href} className="block min-h-11 min-w-0 shrink truncate font-bold leading-[2.75rem] no-underline hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white" data-testid="dayof-title">{item.title}</Link>}
              <Link href={item.href} className={partClass} data-testid="dayof-when">{dayOfText(item, now)}</Link>
              {item.city && <Link href={item.href} className={`${partClass} hidden min-[900px]:inline-flex`} data-testid="dayof-city">{item.city}</Link>}
              {item.mapsQuery && <a href={dayOfDirectionsHref(item.mapsQuery)} target="_blank" rel="noopener noreferrer" className={`${partClass} underline`} data-testid="dayof-directions">Directions</a>}
              {admin && item.kind === "show" && slug && item.fanPreview && <a href={fanPreviewHref(slug, item.id)} target="_blank" rel="noopener noreferrer" className={`${partClass} hidden underline min-[900px]:inline-flex`} data-testid="dayof-fan-preview">Preview Fan Page</a>}
              {admin && item.kind === "show" && <Link href={`${item.href}?tab=promotion`} className={`${partClass} hidden underline min-[900px]:inline-flex`} data-testid="dayof-fan-edit">Edit Fan Page</Link>}
            </div>
          )}
          <button type="button" aria-label={dayOfDismissLabel(item)} data-testid="dayof-dismiss" onClick={() => hide(item)}
            className="grid h-11 w-11 shrink-0 place-items-center min-[900px]:mr-3">
            <span className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </span>
          </button>
        </div>
      ))}
    </section>
  );
}
