/**
 * Refreshing a venue's calendar: run its reader, the shared post-step (dates in the venue's zone, acts from the title, music
 * only, the calendar's filter), then upsert `venueEvents` by source id. An upcoming show that is no longer listed is marked
 * gone, never deleted; past shows stay (they show who books the room). The run's health goes to `venueEventSources/{venueId}`.
 * Both are written directly with the admin SDK: a copy of a public page, re-read on Refresh, with nothing for History to undo.
 */
import { createHash } from "node:crypto";
import { firestore } from "../admin";
import { db, type Doc } from "../db";
import { systemCtx } from "../ctx";
import { AppError } from "../errors";
import { DEFAULT_TIME_ZONE } from "@/lib/timezone";
import { roomStats } from "@/lib/venueEvents";
import { VenueCalendar, VenueEvent, type OpenerSlot, type VenueEventSource } from "@/schema";
import { Net } from "./fetch";
import { cleanTitle, isMusic, reconcileActs, splitTitle } from "./bill";
import { parseDateText, parseTime, resolveStartsAt, todayIn } from "./dates";
import type { RawEvent, ReaderCtx, ReaderResult } from "./types";
import { READERS } from "./readers";
import { linkActs } from "./acts";
import { markTours } from "./onTour";
import { guessOpenerSlots, type GuessRoom } from "./openerGuess";

export type EventDraft = Omit<VenueEvent, "id" | "venueId" | "source" | "firstSeenAt" | "lastSeenAt">;
export interface ReadOutcome { events: EventDraft[]; unparsed: number; dropped: number; raw: number; bill: ReaderResult["bill"] }

const re = (s: string | undefined) => { if (!s) return undefined; try { return new RegExp(s, "i"); } catch { return undefined; } };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const venueMatches = (want: string, got: string | undefined) => !!got && (norm(got).includes(norm(want)) || norm(want).includes(norm(got)));

/** One raw row → an event draft, or why not. */
export function toDraft(r: RawEvent, ctx: { tz: string; now: Date; bill: ReaderResult["bill"]; dateFormat?: string }): EventDraft | "unparsed" | "empty" {
  const title = cleanTitle(r.title ?? "");
  if (!title) return "empty";
  let date = r.date, start = r.start, doors = r.doors;
  if (!date && r.startsAt) { const d = resolveStartsAt(r.startsAt, ctx.tz); if (d) { date = d.date; start ??= d.time; } }
  if (!date && r.dateText) { const d = parseDateText(r.dateText, { tz: ctx.tz, now: ctx.now, format: ctx.dateFormat }); if (d) { date = d.date; start ??= d.time; } }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "unparsed";
  start = parseTime(r.timeText, "show") ?? start;
  doors = parseTime(r.doorsText, "doors") ?? doors;
  if (start === "00:00") start = undefined; // an all-day item stored at midnight
  const bill = r.acts?.length ? reconcileActs(r.acts, title) : splitTitle(title);
  const sourceId = r.sourceId || (r.ticketUrl ? `${r.ticketUrl}|${date}` : `${date}|${title.toLowerCase()}`);
  return {
    sourceId, date, title, acts: bill.acts, bill: r.acts?.length && ctx.bill === "title" ? "headliner" : ctx.bill,
    ...(start ? { start } : {}), ...(doors ? { doors } : {}),
    ...(bill.supportTba ? { supportTba: true } : {}),
    ...(r.imageUrl ? { imageUrl: r.imageUrl } : {}), ...(r.ticketUrl ? { ticketUrl: r.ticketUrl } : {}),
    status: r.status ?? "onsale",
  };
}

/** Read a calendar without writing anything: the setup preview, the dry runs, and refreshVenue. */
export async function readCalendar(cal: VenueCalendar, rc: ReaderCtx): Promise<ReadOutcome> {
  if (cal.type === "manual") return { events: [], unparsed: 0, dropped: 0, raw: 0, bill: "title" };
  const reader = READERS[cal.type] as (c: VenueCalendar, x: ReaderCtx) => Promise<ReaderResult>;
  const res = await reader(cal, rc);
  const f = "filter" in cal ? cal.filter : undefined;
  const inc = re(f?.include), exc = re(f?.exclude);
  const seen = new Set<string>();
  const events: EventDraft[] = [];
  let unparsed = 0, dropped = 0;
  for (const r of res.events) {
    if (f?.venueName && !venueMatches(f.venueName, r.venueName)) { dropped++; continue; }
    const hay = `${r.title} ${(r.tags ?? []).join(" ")}`;
    if (exc?.test(hay)) { dropped++; continue; }
    if (inc ? !inc.test(hay) : !isMusic(r.title, r.tags, r.description)) { dropped++; continue; }
    const d = toDraft(r, { tz: rc.tz, now: rc.now, bill: res.bill, dateFormat: res.dateFormat });
    if (d === "empty") { dropped++; continue; }
    if (d === "unparsed") { unparsed++; continue; }
    if (f?.venueName) {
      const at = new RegExp(`\\s+(?:at|@)\\s+(?:the\\s+)?${f.venueName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*$`, "i");
      d.acts = d.acts.map((a) => ({ ...a, name: a.name.replace(at, "") })).filter((a) => a.name);
    }
    if (seen.has(d.sourceId)) continue;
    seen.add(d.sourceId);
    events.push(d);
  }
  events.sort((a, b) => (a.date + (a.start ?? "")).localeCompare(b.date + (b.start ?? "")));
  markRuns(events);
  return { events, unparsed, dropped, raw: res.events.length, bill: res.bill };
}

const headKey = (e: EventDraft) => (e.acts.find((a) => a.role === "headliner")?.name ?? e.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const nextDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** The same headliner on nights in a row is a run: each of its shows gets `nights` (how many). Drafts are sorted by date. */
export function markRuns(events: EventDraft[]) {
  const byHead = new Map<string, EventDraft[]>();
  for (const e of events) if (e.status !== "cancelled") byHead.set(headKey(e), [...(byHead.get(headKey(e)) ?? []), e]);
  for (const list of byHead.values()) {
    let run: EventDraft[] = [];
    const close = () => { if (run.length > 1) for (const e of run) e.nights = run.length; run = []; };
    for (const e of list) {
      const last = run[run.length - 1];
      if (last && (e.date === last.date || e.date === nextDay(last.date))) { if (e.date !== last.date) run.push(e); continue; }
      close();
      run = [e];
    }
    close();
  }
}

/** The venue-calendar refresh reads and writes the shared directory (venues, venueEvents), not one artist's records. */
const sys = () => systemCtx("venue-calendars");

export const eventId = (venueId: string, sourceId: string) => `${venueId}__${createHash("sha1").update(sourceId).digest("hex").slice(0, 16)}`;

export interface RefreshResult { venueId: string; name: string; type: VenueCalendar["type"] | "none"; count: number; upcoming: number; added: number; gone: number; unparsed: number; dropped: number; error?: string; skipped?: string }

async function writeAll(writes: [string, Record<string, unknown>][]) {
  const fs = firestore();
  for (let i = 0; i < writes.length; i += 400) {
    const b = fs.batch();
    for (const [path, data] of writes.slice(i, i + 400)) b.set(fs.doc(path), data);
    await b.commit();
  }
}

/** A ticket note in brackets ("(TWO-DAY TICKETS)", "[VIP tickets]"): not part of which show it is. */
const TICKET_NOTE = /[([][^)\]]*\btickets?\b[^)\]]*[)\]]/gi;
/** Which show a draft is, for de-duping one calendar's listing: its date and headliner, ticket notes aside. */
export const showKey = (e: Pick<EventDraft, "date" | "title" | "acts">) =>
  `${e.date}|${(e.acts.find((a) => a.role === "headliner")?.name ?? e.title).replace(TICKET_NOTE, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")}`;
/**
 * One calendar listing the same show twice (two ticket links, a two-day pass, the same row twice): same date and headliner, and the
 * same start time or one without a time. Different times stay apart (an early and a late show). Keeps the copy already stored (a
 * band's note or pitch points at it), else the first listed. docs/designs/venue-refresh.md.
 */
export function dedupeDrafts(drafts: EventDraft[], stored: (sourceId: string) => boolean): EventDraft[] {
  const groups = new Map<string, EventDraft[]>();
  for (const d of drafts) groups.set(showKey(d), [...(groups.get(showKey(d)) ?? []), d]);
  const drop = new Set<EventDraft>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const kept: EventDraft[] = [];
    for (const d of [...list.filter((x) => stored(x.sourceId)), ...list.filter((x) => !stored(x.sourceId))]) {
      const twin = kept.find((k) => !k.start || !d.start || k.start === d.start);
      if (twin) { drop.add(d); if (!twin.start && d.start) twin.start = d.start; } else kept.push(d);
    }
  }
  return drafts.filter((d) => !drop.has(d));
}

/** Upsert one venue's drafts. Returns how many were new and how many upcoming ones went missing. */
export async function upsertEvents(venueId: string, type: VenueCalendar["type"], listed: EventDraft[], now: Date, tz: string) {
  const nowIso = now.toISOString();
  const today = todayIn(tz, now);
  const existing = new Map((await db.list(sys(), "venueEvents", (q) => q.where("venueId", "==", venueId), { includeDeleted: true })).map((d) => [d.id, d]));
  const drafts = dedupeDrafts(listed, (sourceId) => { const p = existing.get(eventId(venueId, sourceId)); return !!p && p.status !== "gone"; });
  await linkActs(drafts); // acts[].actId by matchKey, new acts for new names (#77)
  const writes: [string, Record<string, unknown>][] = [];
  const keep = new Set<string>();
  let added = 0, gone = 0;
  for (const d of drafts) {
    const id = eventId(venueId, d.sourceId);
    keep.add(id);
    const prev = existing.get(id);
    if (!prev) added++;
    const slot = keepSlot(prev?.openerSlot as OpenerSlot | undefined, d, nowIso);
    const doc = VenueEvent.parse({ ...d, id, venueId, source: type, ...(slot ? { openerSlot: slot } : {}), firstSeenAt: (prev?.firstSeenAt as string | undefined) ?? nowIso, lastSeenAt: nowIso });
    writes.push([`venueEvents/${id}`, doc]);
  }
  // A source that suddenly lists nothing (a bot wall, a redesign) is flagged on the venue's health, not taken as every show
  // being called off: nothing is marked gone until it lists shows again.
  for (const [id, prev] of drafts.length ? existing : []) {
    if (keep.has(id) || prev.status === "gone" || String(prev.date) < today) continue;
    writes.push([`venueEvents/${id}`, { ...stripId(prev), id, status: "gone" }]);
    gone++;
  }
  await writeAll(writes);
  return { added, gone };
}
/**
 * A show's opener slot across refreshes: a person's stays as they set it; a guess that said open turns off once the calendar
 * lists support. Shows with none get the import's guess after the write (guessNew).
 */
export function keepSlot(prev: OpenerSlot | undefined, d: Pick<EventDraft, "acts">, nowIso: string): OpenerSlot | undefined {
  if (prev?.by === "guess" && prev.open && d.acts.some((a) => a.role !== "headliner")) return { open: false, by: "guess", why: "Support now listed", at: nowIso };
  return prev;
}

/** The import's guess for every upcoming show of this room that has none yet (new ones, and any from before the field). */
async function guessNew(v: Doc, stored: VenueEvent[], record: GuessRoom["stats"], today: string, now: Date) {
  const need = stored.filter((e) => !e.openerSlot && e.date >= today && e.status !== "gone" && e.status !== "cancelled");
  if (!need.length) return;
  const typeLabel = v.type ? String((await db.get(sys(), "venueTypes", String(v.type)))?.label ?? v.type) : undefined;
  const room: GuessRoom = { name: String(v.name), type: typeLabel, capacity: v.capacity as number | undefined, city: (v.address as { city?: string } | undefined)?.city, stats: record };
  const got = await guessOpenerSlots(need, room, today, { now });
  const fs = firestore();
  const list = [...got];
  for (let i = 0; i < list.length; i += 400) {
    const b = fs.batch();
    for (const [id, slot] of list.slice(i, i + 400)) b.update(fs.doc(`venueEvents/${id}`), { openerSlot: slot });
    await b.commit();
  }
}

const stripId = (d: Doc) => { const { id: _id, ...rest } = d; return rest; };

/** Refresh one venue. Never throws for a source's failure: it is recorded on the venue's health and returned. */
export async function refreshVenue(venueId: string, opts: { net?: Net; now?: Date } = {}): Promise<RefreshResult> {
  const v = await db.get(sys(), "venues", venueId);
  if (!v || v.deletedAt) throw new AppError("not_found", "Venue not found", 404);
  const now = opts.now ?? new Date();
  const tz = (v.timeZone as string | undefined) || DEFAULT_TIME_ZONE; // a system job has no artist: the venue's zone, else the default
  const base = { venueId, name: String(v.name), count: 0, upcoming: 0, added: 0, gone: 0, unparsed: 0, dropped: 0 };
  const parsed = VenueCalendar.safeParse(v.calendar);
  if (!v.calendar || !parsed.success) return { ...base, type: "none", skipped: "no calendar" };
  const cal = parsed.data;
  if (cal.type === "manual") return { ...base, type: "manual", skipped: cal.note };
  const health: VenueEventSource = { venueId, type: cal.type, lastRunAt: now.toISOString() };
  const prev = (await db.get(sys(), "venueEventSources", venueId)) as Partial<VenueEventSource> | null;
  try {
    const out = await readCalendar(cal, { net: opts.net ?? new Net(), tz, now });
    const { added, gone } = await upsertEvents(venueId, cal.type, out.events, now, tz);
    const today = todayIn(tz, now);
    // The room's record, over every stored show (past ones too), now that this run's are written.
    const stored = await db.list(sys(), "venueEvents", (q) => q.where("venueId", "==", venueId), { includeDeleted: true });
    const record = roomStats(stored as unknown as VenueEvent[], today);
    // On tour: this room's upcoming headliners (gone ones too, so a run that broke up is unmarked), across every room listing them.
    await markTours(sys(), (stored as unknown as VenueEvent[]).filter((e) => e.date >= today).flatMap((e) => e.acts.filter((a) => a.role === "headliner" && a.actId).map((a) => a.actId!)), today);
    // On tour is marked now, so the guess sees it. Re-read: markTours wrote tourStops.
    await guessNew(v, (await db.list(sys(), "venueEvents", (q) => q.where("venueId", "==", venueId), { includeDeleted: true })) as unknown as VenueEvent[], record, today, now);
    Object.assign(health, { lastSuccessAt: health.lastRunAt, lastCount: out.events.length, lastUnparsed: out.unparsed, ...record });
    await firestore().doc(`venueEventSources/${venueId}`).set(health);
    return { ...base, type: cal.type, count: out.events.length, upcoming: out.events.filter((e) => e.date >= today).length, added, gone, unparsed: out.unparsed, dropped: out.dropped };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await firestore().doc(`venueEventSources/${venueId}`).set({ ...health, ...(prev?.lastSuccessAt ? { lastSuccessAt: prev.lastSuccessAt, lastCount: prev.lastCount ?? 0 } : {}), ...(prev?.billsSeen !== undefined ? { billsSeen: prev.billsSeen, ...(prev.supportShare !== undefined ? { supportShare: prev.supportShare } : {}) } : {}), lastError: msg.slice(0, 300) });
    return { ...base, type: cal.type, error: msg };
  }
}

/** The page a calendar reads first: venues on the same page (a preset shared by several rooms) share one fetch. */
const pageOf = (c: VenueCalendar) => ("url" in c ? c.url : "baseUrl" in c ? c.baseUrl : `${c.type}:${"siteId" in c ? c.siteId : "slug" in c ? c.slug : "organizerId" in c ? c.organizerId : ""}`);

/**
 * Refresh every venue with a readable calendar, a few at a time. Venues on one page share a Net (its cache) and run one after
 * another; every other venue gets its own, dropped when it's done, so pages aren't all held in memory at once (the whole run
 * in one cache overran the 512 MB App Hosting instance, 2026-11-11).
 */
/** How many venues one scheduled call refreshes, how many at once, and how old a last run must be to count as stale. */
export const SLICE = { max: 6, concurrency: 2, staleHours: 20 };

/**
 * The scheduled refresh's slice (docs/designs/venue-refresh.md): the venues with a readable calendar whose last run is oldest and
 * more than `staleHours` ago, never-run ones first, at most `max`, refreshed `concurrency` at a time. Small enough for one request
 * on the 512 MB instance; the venue-calendars GitHub workflow calls it every 15 minutes overnight until every calendar is fresh.
 */
export async function refreshStale(opts: { now?: Date; max?: number; concurrency?: number; staleHours?: number } = {}): Promise<{ picked: string[]; results: RefreshResult[] }> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.staleHours ?? SLICE.staleHours) * 3_600_000).toISOString();
  const venues = (await db.list(sys(), "venues")).filter((v) => !v.mergedInto && VenueCalendar.safeParse(v.calendar).success && (v.calendar as VenueCalendar).type !== "manual");
  const lastRun = new Map((await db.list(sys(), "venueEventSources")).map((s) => [String(s.venueId ?? s.id), String(s.lastRunAt ?? "")]));
  const picked = venues.map((v) => ({ id: v.id, at: lastRun.get(v.id) ?? "" }))
    .filter((v) => v.at < cutoff)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    .slice(0, opts.max ?? SLICE.max).map((v) => v.id);
  if (!picked.length) return { picked, results: [] };
  return { picked, results: await refreshAll({ only: picked, concurrency: opts.concurrency ?? SLICE.concurrency, now }) };
}

export async function refreshAll(opts: { only?: string[]; concurrency?: number; now?: Date } = {}): Promise<RefreshResult[]> {
  const venues = (await db.list(sys(), "venues")).filter((v) => v.calendar && (v.calendar as VenueCalendar).type !== "manual" && !v.mergedInto && (!opts.only || opts.only.includes(v.id)));
  const groups = new Map<string, Doc[]>();
  for (const v of venues) {
    const k = VenueCalendar.safeParse(v.calendar).success ? pageOf(v.calendar as VenueCalendar) : v.id;
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  const queue = [...groups.values()];
  const out: RefreshResult[] = [];
  const worker = async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      const net = new Net();
      for (const v of g) out.push(await refreshVenue(v.id, { net, now: opts.now }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, queue.length) }, worker));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
