/** What the iOS Shortcut asks before uploading: which rehearsal, which song. Lists shaped for Shortcuts' Choose from List. */
import type { Ctx } from "./ctx";
import { db, type Doc } from "./db";
import { AppError } from "./errors";
import { fmtLong } from "@/lib/shows";
import { BAND_TIME_ZONE, dateInBandZone } from "@/lib/timezone";

export interface ChoiceList { labels: string[]; ids: Record<string, string> }
/** Labels must be unique (they are the keys of `ids`): a repeat gets " (2)", " (3)"... so no row is lost. */
const choices = (rows: [label: string, id: string][]): ChoiceList => {
  const seen = new Map<string, number>();
  const named = rows.map(([l, id]): [string, string] => { const n = (seen.get(l) ?? 0) + 1; seen.set(l, n); return [n === 1 ? l : `${l} (${n})`, id]; });
  return { labels: named.map(([l]) => l), ids: Object.fromEntries(named) };
};

/** Today's date (YYYY-MM-DD) in the band's time zone (an evening rehearsal is still today, whatever UTC says). */
const today = (now: Date) => dateInBandZone(now);
/** Minutes since midnight in the band's time zone. */
const minutesNow = (now: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: BAND_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
};
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** A rehearsal with no end time is taken to run this long from its start. */
export const DEFAULT_REHEARSAL_MINUTES = 4 * 60;
export const DAYS_BACK = 30, DAYS_AHEAD = 7;

/** Rehearsals from a month back to a week ahead, nearest to today first; today's own is first of all. */
export async function recentRehearsals(ctx: Ctx, now = ctx.now ?? new Date()): Promise<{ rehearsals: ChoiceList }> {
  const t = new Date(today(now) + "T00:00:00Z").getTime();
  const day = 86_400_000;
  const all = (await db.list("rehearsals")).filter((r: Doc) => !r.deletedAt && (!r.artistId || r.artistId === ctx.artistId));
  const near = all
    .map((r) => ({ r, d: (new Date(`${r.date}T00:00:00Z`).getTime() - t) / day }))
    .filter(({ d }) => d >= -DAYS_BACK && d <= DAYS_AHEAD)
    .sort((a, b) => Math.abs(a.d) - Math.abs(b.d) || b.d - a.d);
  return { rehearsals: choices(near.map(({ r, d }) => [`${d === 0 ? "Today · " : ""}${fmtLong(r.date as string)}${r.location?.name ? ` · ${r.location.name}` : ""}`, r.id])) };
}

/** The rehearsal happening right now: today, between its start and end time (end defaults to four hours after the start). Needs a start time. */
export async function rehearsalNow(ctx: Ctx, now = ctx.now ?? new Date()): Promise<Doc | null> {
  const day = today(now), m = minutesNow(now);
  const all = (await db.list("rehearsals")).filter((r: Doc) => !r.deletedAt && r.date === day && r.startTime && (!r.artistId || r.artistId === ctx.artistId));
  const on = all.filter((r) => {
    const start = minutesOf(r.startTime as string);
    const end = r.endTime ? minutesOf(r.endTime as string) : start + DEFAULT_REHEARSAL_MINUTES;
    return m >= start && m <= end;
  });
  return on.sort((a, b) => (a.startTime as string).localeCompare(b.startTime as string))[0] ?? null;
}

/**
 * One call for the Shortcut's first step: when a rehearsal is on now, `{ rehearsal: { id, date, label }, songs }` (skip
 * "Which rehearsal?"); otherwise `{ rehearsals }` as recentRehearsals gives it. The Shortcut branches on `rehearsal`.
 */
export async function shortcutNow(ctx: Ctx, now = ctx.now ?? new Date()) {
  const reh = await rehearsalNow(ctx, now);
  if (!reh) return recentRehearsals(ctx, now);
  const { rehearsal, songs } = await rehearsalSongs(ctx, reh.id);
  return { rehearsal: { ...rehearsal, label: `${fmtLong(rehearsal.date)}${reh.location?.name ? ` · ${reh.location.name}` : ""}` }, songs };
}

/** The songs on one rehearsal, in its order, titled as the songs are now. */
export async function rehearsalSongs(ctx: Ctx, rehearsalId: string): Promise<{ rehearsal: { id: string; date: string }; songs: ChoiceList }> {
  const reh = await db.get("rehearsals", rehearsalId);
  if (!reh || reh.deletedAt || (reh.artistId && reh.artistId !== ctx.artistId)) throw new AppError("not_found", "Rehearsal not found", 404);
  const songs = await db.list("songs");
  const titles = new Map(songs.filter((s) => !s.deletedAt).map((s) => [s.id, s.title as string]));
  const rows: [string, string][] = [];
  for (const s of (reh.songs ?? []) as { songId: string; title?: string }[]) {
    const title = titles.get(s.songId) ?? s.title;
    if (title && !rows.some(([l]) => l === title)) rows.push([title, s.songId]);
  }
  return { rehearsal: { id: reh.id, date: reh.date as string }, songs: choices(rows) };
}
