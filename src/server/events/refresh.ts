/**
 * Refreshing a venue's calendar: run its reader, the shared post-step (dates in the venue's zone, acts from the title, music
 * only, the calendar's filter), then upsert `venueEvents` by source id. An upcoming show that is no longer listed is marked
 * gone, never deleted; past shows stay (they show who books the room). The run's health goes to `venueEventSources/{venueId}`.
 * Both are written directly with the admin SDK: a copy of a public page, re-read on Refresh, with nothing for History to undo.
 */
import { createHash } from "node:crypto";
import { firestore } from "../admin";
import { db, type Doc } from "../db";
import { AppError } from "../errors";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import { VenueCalendar, VenueEvent, type VenueEventSource } from "@/schema";
import { Net } from "./fetch";
import { cleanTitle, isMusic, reconcileActs, splitTitle } from "./bill";
import { parseDateText, parseTime, resolveStartsAt, todayIn } from "./dates";
import type { RawEvent, ReaderCtx, ReaderResult } from "./types";
import { READERS } from "./readers";

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
  return { events, unparsed, dropped, raw: res.events.length, bill: res.bill };
}

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

/** Upsert one venue's drafts. Returns how many were new and how many upcoming ones went missing. */
export async function upsertEvents(venueId: string, type: VenueCalendar["type"], drafts: EventDraft[], now: Date, tz: string) {
  const nowIso = now.toISOString();
  const today = todayIn(tz, now);
  const existing = new Map((await db.list("venueEvents", (q) => q.where("venueId", "==", venueId), { includeDeleted: true })).map((d) => [d.id, d]));
  const writes: [string, Record<string, unknown>][] = [];
  const keep = new Set<string>();
  let added = 0, gone = 0;
  for (const d of drafts) {
    const id = eventId(venueId, d.sourceId);
    keep.add(id);
    const prev = existing.get(id);
    if (!prev) added++;
    const doc = VenueEvent.parse({ ...d, id, venueId, source: type, firstSeenAt: (prev?.firstSeenAt as string | undefined) ?? nowIso, lastSeenAt: nowIso });
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
const stripId = (d: Doc) => { const { id: _id, ...rest } = d; return rest; };

/** Refresh one venue. Never throws for a source's failure: it is recorded on the venue's health and returned. */
export async function refreshVenue(venueId: string, opts: { net?: Net; now?: Date } = {}): Promise<RefreshResult> {
  const v = await db.get("venues", venueId);
  if (!v || v.deletedAt) throw new AppError("not_found", "Venue not found", 404);
  const now = opts.now ?? new Date();
  const tz = (v.timeZone as string | undefined) || BAND_TIME_ZONE;
  const base = { venueId, name: String(v.name), count: 0, upcoming: 0, added: 0, gone: 0, unparsed: 0, dropped: 0 };
  const parsed = VenueCalendar.safeParse(v.calendar);
  if (!v.calendar || !parsed.success) return { ...base, type: "none", skipped: "no calendar" };
  const cal = parsed.data;
  if (cal.type === "manual") return { ...base, type: "manual", skipped: cal.note };
  const health: VenueEventSource = { venueId, type: cal.type, lastRunAt: now.toISOString() };
  const prev = (await db.get("venueEventSources", venueId)) as Partial<VenueEventSource> | null;
  try {
    const out = await readCalendar(cal, { net: opts.net ?? new Net(), tz, now });
    const { added, gone } = await upsertEvents(venueId, cal.type, out.events, now, tz);
    const today = todayIn(tz, now);
    Object.assign(health, { lastSuccessAt: health.lastRunAt, lastCount: out.events.length, lastUnparsed: out.unparsed });
    await firestore().doc(`venueEventSources/${venueId}`).set(health);
    return { ...base, type: cal.type, count: out.events.length, upcoming: out.events.filter((e) => e.date >= today).length, added, gone, unparsed: out.unparsed, dropped: out.dropped };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await firestore().doc(`venueEventSources/${venueId}`).set({ ...health, ...(prev?.lastSuccessAt ? { lastSuccessAt: prev.lastSuccessAt, lastCount: prev.lastCount ?? 0 } : {}), lastError: msg.slice(0, 300) });
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
export async function refreshAll(opts: { only?: string[]; concurrency?: number; now?: Date } = {}): Promise<RefreshResult[]> {
  const venues = (await db.list("venues")).filter((v) => v.calendar && (v.calendar as VenueCalendar).type !== "manual" && !v.mergedInto && (!opts.only || opts.only.includes(v.id)));
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
