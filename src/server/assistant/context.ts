/** `context.now` and `search`: Roadie's two read tools. Both go through commands, so they return only what the caller may read. */
import { BAND_TIME_ZONE, dateInBandZone, fmtInstant } from "@/lib/timezone";
import { addDays, isOff, isPlayed, SHOW_FILTERS, showCity, showFilter, showName, type ShowFilter, type ShowPlaceLike } from "@/lib/shows";
import { incomeSoFar, owedToUs, owesBack, weOwe, type ExpenseLike, type IncomeLike, type PayoutLike } from "@/lib/money";
import { RECORD_ROUTES } from "@/lib/routes";
import type { PageContext } from "@/schema/assistant";
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
  const admin = s.role === "admin"; // income and payouts are admin-only
  const [shows, income, expenses, payouts, projects, artists, musicians, tours] = await Promise.all([
    list(ctx, "shows"), admin ? list(ctx, "income") : [], list(ctx, "expenses"), admin ? list(ctx, "payouts") : [], list(ctx, "projects"), list(ctx, "artists"), list(ctx, "musicians"),
    runAs(ctx, "tours.list", {}).then((r) => (r.result as { tours: Row[] }).tours, () => [] as Row[]),
  ]);
  const a = artists.find((x) => x.id === ctx.artistId) ?? artists[0]; // records.list is already limited to the current artist
  const live = shows.filter((x) => !isOff(x));
  // Money is entered once the show has an income record.
  const settled = new Set(income.filter((x) => !x.deletedAt && x.showId).map((x) => x.showId as string));
  const team = musicians.filter((m) => !m.archivedAt);
  const nameOf = (uid: string) => team.find((m) => m.userId === uid)?.name ?? (uid === s.uid ? s.name : "someone");
  const owe = admin ? weOwe({ payouts: payouts as PayoutLike[], expenses: expenses as ExpenseLike[], musicianUserId: (id) => musicians.find((m) => m.id === id)?.userId ?? undefined, personName: nameOf }) : [];
  // A show that hasn't happened yet is not owed to us yet: its guarantee is dated on the show.
  const owed = admin ? owedToUs({ income: incomeSoFar(income as IncomeLike[], today) }) : { items: [], total: 0 };
  const tonight = tonightDate(now);
  return {
    speaker: { userId: s.uid, name: s.name, role: s.role, musicianId: s.musicianId ?? null },
    now: now.toISOString(), localTime: fmtInstant(now, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }), timeZone: BAND_TIME_ZONE,
    today, tonight,
    artist: a ? { id: a.id, name: a.name, slug: a.slug, configurations: ((a.configurations ?? []) as Row[]).map((c) => ({ id: c.id, name: c.name })) } : null,
    band: team.map((m) => ({ musicianId: m.id, name: m.name, userId: m.userId ?? null, instruments: m.instruments ?? [] })),
    todaysShows: live.filter((x) => x.date === today || x.date === tonight).map(showLine),
    unsettledShows: live.filter((x) => isPlayed(x as never, today) && !settled.has(x.id)).map(showLine),
    // Where a record goes ("put it on Lighthouse video"): the open projects. The default one (Band) takes anything with no project named.
    projects: projects.filter((p) => !p.deletedAt && p.status === "open").map((p) => ({ id: p.id, name: p.name, kind: p.kind, isDefault: !!p.isDefault })),
    // Tours not done yet ("the tour", "Mountain West"): ids for tours.summary, tours.addShow, tours.addPitch, tours.entries.add.
    tours: tours.filter((t) => t.status !== "done").map((t) => ({ id: t.id, name: t.name, status: t.status, startDate: t.startDate, endDate: t.endDate })),
    // What we owe, by person: userId/musicianId/contactId say who; items carry the ids for payouts.markPaid (kind payout), expenses.markPaid (kind bill: a vendor nobody has paid) and expenses.payPerson { userId } (kind expense: pay a member back).
    weOwe: owe.map((g) => ({ name: g.name, userId: g.userId ?? null, musicianId: g.musicianId ?? null, contactId: g.contactId ?? null, totalCents: g.total,
      items: g.items.map((x) => ({ kind: x.kind, id: x.id, what: x.what, amountCents: x.amount, date: x.date || null, projectId: x.projectId ?? null, showId: x.showId ?? null })) })),
    // What's still coming to us: income with no receivedAt, for income.setReceived.
    owedToUs: { totalCents: owed.total, items: owed.items.map((x) => ({ id: x.id, from: x.from, category: x.category, amountCents: x.amount, date: x.date, projectId: x.projectId, showId: x.showId ?? null })) },
    openExpenses: expenses.filter((e) => !e.deletedAt && owesBack(e as never))
      .map((e) => ({ id: e.id, what: e.what, amountCents: e.amount, userId: e.userId, date: e.date, showId: e.showId ?? null })),
  };
}

/** Records on a page with custom fields: the collection, and where on the artist its field definitions live. */
const FIELD_DEFS: Record<string, "showFields" | "songFields"> = { shows: "showFields", songs: "songFields" };
/** The page's record is cut off past this many characters of JSON (a pitch's timeline can run long). */
export const PAGE_RECORD_CHARS = 8000;

/**
 * The record on the page the person is looking at ("this one", "here"), read as them: its collection (what records.get
 * takes), the record, and for shows and songs the band's custom fields with their labels. Null off a record page or when
 * the record can't be read.
 */
export async function pageRecord(ctx: Ctx, page: PageContext) {
  const kind = page.recordKind && page.recordId ? (RECORD_ROUTES as Record<string, string>)[page.recordKind] : undefined;
  if (!kind) return null;
  let record: Row;
  try { record = (await runAs(ctx, "records.get", { kind, id: page.recordId })).result as Row; } catch { return null; }
  const defs = FIELD_DEFS[kind];
  let customFields: { fieldId: string; label: string; value: string | null }[] | undefined;
  if (defs) {
    const artists = await list(ctx, "artists");
    const a = artists.find((x) => x.id === ctx.artistId) ?? artists[0]; // records.list is already limited to the current artist
    const values = new Map(((record.fields ?? []) as { fieldId: string; value: string }[]).map((f) => [f.fieldId, f.value]));
    customFields = ((a?.[defs] ?? []) as { id: string; label: string }[]).map((f) => ({ fieldId: f.id, label: f.label, value: values.get(f.id) ?? null }));
  }
  const json = JSON.stringify(record);
  const shown = json.length > PAGE_RECORD_CHARS ? `${json.slice(0, PAGE_RECORD_CHARS)}…(cut off: records.get for the rest)` : record;
  return { kind, id: page.recordId!, record: shown, ...(customFields ? { customFields } : {}) };
}

/** Rows of a list page shown to Roadie at most; the count says how many there are. */
export const PAGE_LIST_ROWS = 40;

/**
 * The rows on a list page the person is looking at ("that show", "the one on the 13th"), read as them. Only the Shows
 * page so far, by its tab (#played...; Upcoming when none). Null on every other page.
 */
export async function pageList(ctx: Ctx, page: PageContext) {
  if (page.route !== "shows") return null;
  const tab: ShowFilter = (SHOW_FILTERS as readonly string[]).includes(page.tab ?? "") ? (page.tab as ShowFilter) : "upcoming";
  const today = dateInBandZone(ctx.now ?? new Date());
  // Same order as the page: Upcoming soonest first, the rest most recent first.
  const rows = (await list(ctx, "shows")).filter((s) => showFilter(s as never, today) === tab)
    .sort((a, b) => (tab === "upcoming" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  return { list: "shows", tab, count: rows.length, rows: rows.slice(0, PAGE_LIST_ROWS).map(showLine) };
}

export const SEARCH_KINDS = ["venue", "promoter", "festival", "edition", "contact", "pitch", "show", "song", "musician", "setlistTemplate", "release"] as const;
const BOOKING = new Set(["venue", "promoter", "festival", "edition", "contact", "pitch"]);

/** Venues, promoters, festivals, years, contacts and pitches (the `search` command) plus shows, songs and musicians, by name. */
export async function searchAll(ctx: Ctx, i: { q: string; kinds?: string[]; limit?: number }) {
  const want = new Set<string>(i.kinds?.length ? i.kinds : SEARCH_KINDS);
  const words = i.q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const out: { kind: string; id: string; name: string; sub?: string; userId?: string }[] = [];
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
  if (want.has("musician")) for (const m of await list(ctx, "musicians")) if (hit(`${m.name}`)) out.push({ kind: "musician", id: m.id, name: m.name, sub: "Musician", ...(m.userId ? { userId: m.userId } : {}) });
  if (want.has("setlistTemplate")) for (const t of await list(ctx, "setlistTemplates")) if (hit(`${t.name}`)) out.push({ kind: "setlistTemplate", id: t.id, name: t.name, sub: "Setlist template" });
  if (want.has("release")) for (const a of await list(ctx, "releases")) if (hit(`${a.title} release ${a.kind}`)) out.push({ kind: "release", id: a.id, name: a.title, sub: `Release · ${a.status}` });
  const rows = out.slice(0, i.limit ?? 25);
  return { count: rows.length, results: rows };
}
