/** What the iOS Shortcut asks before uploading: which rehearsal, which song. Lists shaped for Shortcuts' Choose from List. */
import type { Ctx } from "./ctx";
import { db, type Doc } from "./db";
import { AppError } from "./errors";
import { fmtLong } from "@/lib/shows";

export interface ChoiceList { labels: string[]; ids: Record<string, string> }
const choices = (rows: [label: string, id: string][]): ChoiceList => ({ labels: rows.map(([l]) => l), ids: Object.fromEntries(rows) });

/** Today's date (YYYY-MM-DD) in the band's time zone, or the server's when none is known. */
const today = (now: Date) => now.toISOString().slice(0, 10);
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
