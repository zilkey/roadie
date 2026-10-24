/** `context.now` and `search`: Roadie's two read tools. Both go through commands, so they return only what the caller may read. */
import { BAND_TIME_ZONE, dateInBandZone, fmtInstant } from "@/lib/timezone";
import { addDays, isOff, isPlayed, showCity, showName, type ShowPlaceLike } from "@/lib/shows";
import { owesBack } from "@/lib/money";
import type { Ctx } from "../ctx";
import { runAs, type Session } from "./run";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const list = async (ctx: Ctx, kind: string): Promise<Row[]> =>
  ((await runAs(ctx, "records.list", { kind, limit: 200 })).result as { rows: Row[] }).rows;
const showLine = (s: Row) => ({ id: s.id, venue: showName(s as ShowPlaceLike), city: showCity(s as ShowPlaceLike), kind: s.kind, date: s.date, status: s.status, times: s.times });

/** Until 6:00 the next morning, "tonight" is still the show that just happened. */
export function tonightDate(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: BAND_TIME_ZONE, hour: "numeric", hour12: false }).format(now)) % 24;
  const today = dateInBandZone(now);
  return hour < 6 ? addDays(today, -1) : today;
}

export async function contextNow(ctx: Ctx, s: Pick<Session, "uid" | "name" | "role" | "musicianId">) {
  const now = ctx.now ?? new Date();
  const today = dateInBandZone(now);
  const [shows, deals, expenses] = await Promise.all([list(ctx, "shows"), list(ctx, "showDeals"), list(ctx, "expenses")]);
  const live = shows.filter((x) => !isOff(x));
  // Money is entered once the deal has income lines.
  const settled = new Set(deals.filter((d) => ((d.income as unknown[] | undefined) ?? []).length > 0).map((d) => d.id));
  const tonight = tonightDate(now);
  return {
    speaker: { userId: s.uid, name: s.name, role: s.role, musicianId: s.musicianId ?? null },
    now: now.toISOString(), localTime: fmtInstant(now, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), timeZone: BAND_TIME_ZONE,
    today, tonight,
    todaysShows: live.filter((x) => x.date === today || x.date === tonight).map(showLine),
    unsettledShows: live.filter((x) => isPlayed(x as never, today) && !settled.has(x.id)).map(showLine),
    openExpenses: expenses.filter((e) => !e.deletedAt && owesBack(e as never))
      .map((e) => ({ id: e.id, what: e.what, amountCents: e.amount, userId: e.userId, date: e.date, showId: e.showId ?? null })),
  };
}

export const SEARCH_KINDS = ["venue", "promoter", "festival", "edition", "contact", "pitch", "show", "song", "musician"] as const;
const BOOKING = new Set(["venue", "promoter", "festival", "edition", "contact", "pitch"]);

/** Venues, promoters, festivals, years, contacts and pitches (the `search` command) plus shows, songs and musicians, by name. */
export async function searchAll(ctx: Ctx, i: { q: string; kinds?: string[]; limit?: number }) {
  const want = new Set<string>(i.kinds?.length ? i.kinds : SEARCH_KINDS);
  const words = i.q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const out: { kind: string; id: string; name: string; sub?: string }[] = [];
  if (want.has("show")) {
    for (const s of await list(ctx, "shows")) {
      if (hit(`${showName(s as ShowPlaceLike)} ${showCity(s as ShowPlaceLike) ?? ""} ${s.date} ${s.status} ${s.editionName ?? ""} show`)) out.push({ kind: "show", id: s.id, name: `${showName(s as ShowPlaceLike)} · ${s.date}`, sub: `Show · ${s.status}` });
    }
  }
  const booking = [...want].filter((k) => BOOKING.has(k));
  if (booking.length) {
    const r = (await runAs(ctx, "search", { q: i.q, kinds: booking, limit: 25 })).result as { results: { kind: string; id: string; name: string; sub: string }[] };
    out.push(...r.results);
  }
  if (want.has("song")) for (const s of await list(ctx, "songs")) if (hit(`${s.title}`)) out.push({ kind: "song", id: s.id, name: s.title, sub: `Song · ${s.status}` });
  if (want.has("musician")) for (const m of await list(ctx, "musicians")) if (hit(`${m.name}`)) out.push({ kind: "musician", id: m.id, name: m.name, sub: "Musician" });
  const rows = out.slice(0, i.limit ?? 25);
  return { count: rows.length, results: rows };
}
