"use client";
import { useEffect, useRef } from "react";
import { runCommandQuiet } from "@/lib/commands";
import Link, { useMaybeArtist } from "@/lib/artist";
import { bandsintownNewEventUrl } from "@/lib/bandsintown";

/**
 * Beside an "Add to Bandsintown" to-do: "Open Bandsintown ↗" (Bandsintown for Artists' new-event form) while it's open, "Listed ↗"
 * (the event Roadie found) once it's done. Without the band's Bandsintown artist ID it points at General Settings instead.
 */
export function BandsintownLink({ done, eventUrl, testid = "bandsintown-open" }: { done: boolean; eventUrl?: string; testid?: string }) {
  const a = useMaybeArtist();
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (done) return eventUrl ? <a href={eventUrl} target="_blank" rel="noopener noreferrer" className="s shrink-0" onClick={stop} data-testid={`${testid}-listed`}>Listed ↗</a> : null;
  const url = bandsintownNewEventUrl(a?.doc?.bandsintown?.artistId);
  if (url) return <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sm font-semibold" onClick={stop} data-testid={testid}>Open Bandsintown ↗</a>;
  return a?.role === "admin" ? <Link href="/admin/artist#bandsintown" className="s shrink-0" onClick={stop} data-testid={`${testid}-setup`}>Set up Bandsintown</Link> : null;
}

/** The show's "Add to Bandsintown" item and the list it's on, if it has one. */
export function bandsintownItemOf(lists: { id: string; items: { id: string; bandsintown?: true; done: boolean; eventUrl?: string }[] }[]) {
  for (const l of lists) for (const i of l.items) if (i.bandsintown) return { listId: l.id, item: i };
  return null;
}

/**
 * When an admin opens a show whose Bandsintown to-do is still open and the band has its Bandsintown API key, ask Bandsintown
 * once (bandsintown.check): a listing that day there ticks it. Quiet: a failure just leaves the to-do open.
 */
export function useBandsintownAutoCheck(showId: string, open: boolean, admin: boolean) {
  const a = useMaybeArtist();
  const ready = admin && open && !!a?.doc?.bandsintown?.appId && !!a.doc.bandsintown.artistId;
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || asked.current === showId) return;
    asked.current = showId;
    runCommandQuiet("bandsintown.check", { showId }).catch(() => undefined);
  }, [ready, showId]);
}
