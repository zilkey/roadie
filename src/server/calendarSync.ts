/**
 * Show and rehearsal events on the band's shared Google Calendar (artist.calendar, chosen on Settings > Google). Nothing
 * here runs on its own: an admin opens the preview (what will go out, to whom) and presses the button that sends or
 * removes the event. Each write uses that admin's own Google grant, so an admin without write access to the band
 * calendar gets Google's error back; the band assumes several admins can write to it.
 */
import { createHash } from "node:crypto";
import { db, type Doc } from "./db";
import { AppError } from "./errors";
import type { Ctx } from "./ctx";
import { calendarClient, IntegrationError, type CalendarService } from "./integrations";
import type { CalEventInput } from "./integrations/calendar";
import { fmtDuration, setLengthOf } from "@/lib/duration";
import { addDays, fmtTime, isOff, showAddress, showCity, showName, type ShowPlaceLike } from "@/lib/shows";
import { BAND_TIME_ZONE } from "@/lib/timezone";

export type CalendarKind = "shows" | "rehearsals";
export interface Invitee { name: string; email: string }
/** What the preview shows: the event as it will go out, who gets an invite, who doesn't (no email), and what pressing the button does. */
export interface CalendarPreview {
  calendar: { id: string; name: string };
  action: "create" | "update";
  /** On the calendar already and nothing changed since it was last sent. */
  unchanged: boolean;
  event: { title: string; start: string; end: string; allDay: boolean; timeZone: string; location: string; description: string };
  invitees: Invitee[];
  noEmail: string[];
  /** When it would create: events already on the band calendar that day that no other show or rehearsal is linked to. */
  existing: ExistingEvent[];
}
/** An event someone put on the band calendar by hand, which the show or rehearsal can link to instead of adding another. */
export interface ExistingEvent { id: string; title: string; start: string; end: string; allDay: boolean; location: string }

const hhmm = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const at = (date: string, min: number) => `${addDays(date, Math.floor(min / 1440))}T${hhmm(((min % 1440) + 1440) % 1440)}:00`;

/** Local (venue time) start and end as YYYY-MM-DDTHH:MM:00. Starts at load-in, ends after the set. */
export function eventTimes(show: { date: string; times: { loadIn?: string; set?: string; setLengthSec?: number; setLength?: number } }) {
  const t = show.times;
  const startMin = toMin(t.loadIn ?? t.set ?? "18:00");
  const endMin = t.set ? toMin(t.set) + Math.round((setLengthOf(t) ?? 3600) / 60) : startMin + 180;
  return { start: at(show.date, startMin), end: at(show.date, Math.max(endMin, startMin + 30)) };
}

/** A rehearsal's times: start to end (three hours when there's no end), or all day when it has no start time. */
export function rehearsalTimes(r: { date: string; startTime?: string; endTime?: string }) {
  if (!r.startTime) return { start: r.date, end: addDays(r.date, 1) };
  const s = toMin(r.startTime);
  const e = r.endTime ? toMin(r.endTime) : s + 180;
  return { start: at(r.date, s), end: at(r.date, e > s ? e : e + 1440) };
}

async function artistOf(ctx: Ctx, doc: Doc) {
  const id = (doc.artistId as string | undefined) ?? ctx.artistId;
  if (id) return db.get("artists", id);
  return (await db.list("artists")).find((a) => !a.deletedAt) ?? null;
}

async function load(kind: CalendarKind, id: string) {
  const doc = await db.get(kind, id);
  if (!doc || doc.deletedAt) throw new AppError("not_found", kind === "shows" ? "Show not found" : "Rehearsal not found", 404);
  return doc;
}

function showEvent(show: Doc, artist: Doc | null): Omit<CalEventInput, "attendees"> {
  const cfg = (artist?.configurations as { id: string; billingName: string }[] | undefined)?.find((c) => c.id === show.billedAs);
  const who = cfg?.billingName ?? artist?.name ?? "Show";
  const t = show.times as { loadIn?: string; soundcheck?: string; doors?: string; showStart?: string; set?: string; setLengthSec?: number; setLength?: number };
  const len = setLengthOf(t);
  const dayOf = show.dayOfContact as { name: string; phone?: string } | undefined;
  const lines = [
    t.loadIn && `Load in ${fmtTime(t.loadIn)}`, t.soundcheck && `Soundcheck ${fmtTime(t.soundcheck)}`, t.doors && `Doors ${fmtTime(t.doors)}`,
    t.showStart && `Show starts ${fmtTime(t.showStart)}`, t.set && `Set ${fmtTime(t.set)}${len ? ` (${fmtDuration(len)})` : ""}`,
    `Sound: ${show.sound.provider === "bandProvided" ? "we bring it" : "venue provides"}`,
    dayOf && `Day-of contact: ${dayOf.name}${dayOf.phone ? ` ${dayOf.phone}` : ""}`,
  ].filter(Boolean).join("\n");
  return {
    title: `${show.status === "hold" ? "HOLD: " : ""}${who} at ${showName(show as ShowPlaceLike)}`, ...eventTimes(show as unknown as Parameters<typeof eventTimes>[0]), timeZone: BAND_TIME_ZONE,
    location: [show.venue?.name, showAddress(show as ShowPlaceLike) ?? showCity(show as ShowPlaceLike)].filter(Boolean).join(", "), description: lines,
  };
}

function rehearsalEvent(r: Doc, artist: Doc | null): Omit<CalEventInput, "attendees"> {
  const loc = r.location as { name?: string; address?: string } | undefined;
  const songs = (r.songs as { title: string; note?: string }[]).map((s) => `- ${s.title}${s.note ? ` (${s.note})` : ""}`);
  const description = [r.notes as string | undefined, songs.length ? `Songs:\n${songs.join("\n")}` : undefined].filter(Boolean).join("\n\n");
  return {
    title: `${artist?.name ? `${artist.name} rehearsal` : "Rehearsal"}${loc?.name ? ` at ${loc.name}` : ""}`, ...rehearsalTimes(r as unknown as Parameters<typeof rehearsalTimes>[0]),
    timeZone: BAND_TIME_ZONE, location: [loc?.name, loc?.address].filter((x, i, a) => x && a.indexOf(x) === i).join(", "), description,
  };
}

/** Who gets an invite: shows invite calendarInviteeIds when set, else everyone in personnel; rehearsals everyone coming. Musicians with no email can't be invited. */
async function invitees(kind: CalendarKind, doc: Doc) {
  const ids = (kind === "shows" ? (doc.calendarInviteeIds as string[] | undefined) ?? doc.personnel : doc.personnel) as string[];
  const musicians = await db.list("musicians");
  const people = ids.map((id) => musicians.find((m) => m.id === id)).filter((m): m is Doc => !!m);
  return {
    invitees: people.filter((m) => m.email).map((m) => ({ name: m.name as string, email: m.email as string })),
    noEmail: people.filter((m) => !m.email).map((m) => m.name as string),
  };
}

async function build(ctx: Ctx, kind: CalendarKind, id: string) {
  const doc = await load(kind, id);
  const artist = await artistOf(ctx, doc);
  const calendar = artist?.calendar as { id: string; name: string } | null | undefined;
  if (!calendar) throw new AppError("calendar_not_chosen", "No band calendar yet. An admin chooses it on Settings > Google.", 400);
  if (kind === "shows" && isOff(doc)) throw new AppError("invalid_input", `A ${doc.status} show doesn't go on the calendar. Remove its event instead.`, 400);
  const body = kind === "shows" ? showEvent(doc, artist) : rehearsalEvent(doc, artist);
  const who = await invitees(kind, doc);
  const input: CalEventInput = { ...body, attendees: who.invitees.map((p) => p.email) };
  const hash = createHash("sha256").update(JSON.stringify([calendar.id, input])).digest("base64url").slice(0, 16);
  return { doc, calendar, input, who, hash };
}

const client = (ctx: Ctx, calendarId: string): CalendarService => calendarClient({ uid: ctx.uid, calendarId });
const notFound = (e: unknown) => e instanceof IntegrationError && e.status === 404;
/** Google's answer (no access, not connected, ...) as the command's error: the admin pressed a button and should see why. */
function googleError(e: unknown): never {
  if (e instanceof IntegrationError) throw new AppError("calendar_error", `Google Calendar: ${e.message}`, e.status === 401 || e.status === 403 ? 403 : 502);
  throw e;
}

/** Venue words worth matching on: "The Loft" is just "loft". */
const SKIP = new Set(["the", "and"]);
const words = (v: string) => v.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !SKIP.has(w));

/** Could this event be the show or rehearsal? A rehearsal's has "rehearsal" in it; a show's says "show" or shares a word with the venue. */
function looksLike(kind: CalendarKind, doc: Doc, title: string) {
  if (kind === "rehearsals") return /rehearsal/i.test(title);
  const t = new Set(words(title));
  return t.has("show") || t.has("shows") || words(showName(doc as ShowPlaceLike)).some((w) => t.has(w));
}

/**
 * Events on the band calendar on the same day as the show or rehearsal that nothing in the app is linked to yet and
 * that look like it (looksLike). Google gives times in the event's own zone, so the day is the first ten characters. A Google error here just means no suggestions: the
 * preview still works and the admin can add a new event.
 */
async function sameDay(ctx: Ctx, kind: CalendarKind, doc: Doc, calendarId: string): Promise<ExistingEvent[]> {
  const date = doc.date as string;
  const events = await client(ctx, calendarId).list({ from: addDays(date, -1), to: addDays(date, 2) }).catch(() => []);
  const linked = new Set((await Promise.all((["shows", "rehearsals"] as const).map((k) => db.list(k))))
    .flat().map((d) => d.calendarEventId as string | undefined).filter(Boolean));
  return events.filter((e) => e.start.slice(0, 10) === date && !linked.has(e.id) && looksLike(kind, doc, e.title)).map((e) => ({
    id: e.id, title: e.title, start: e.start, end: e.end, allDay: !e.start.includes("T"), location: e.location ?? "",
  }));
}

export async function calendarPreview(ctx: Ctx, kind: CalendarKind, id: string): Promise<CalendarPreview> {
  const { doc, calendar, input, who, hash } = await build(ctx, kind, id);
  return {
    calendar, action: doc.calendarEventId ? "update" : "create", unchanged: !!doc.calendarEventId && doc.calendarHash === hash,
    event: { title: input.title, start: input.start, end: input.end, allDay: !input.start.includes("T"), timeZone: input.timeZone ?? BAND_TIME_ZONE, location: input.location ?? "", description: input.description ?? "" },
    ...who,
    existing: doc.calendarEventId ? [] : await sameDay(ctx, kind, doc, calendar.id),
  };
}

/**
 * Link to an event already on the band calendar (someone added it by hand) instead of adding a second one. Nothing is
 * sent: the event stays as it is until an admin presses Update, whose preview shows what will change.
 */
export async function calendarLink(ctx: Ctx, kind: CalendarKind, id: string, eventId: string): Promise<{ id: string; calendar: "linked" }> {
  const { doc, calendar } = await build(ctx, kind, id);
  if (doc.calendarEventId) throw new AppError("invalid_input", "Already on the band calendar. Remove its event first to link another.", 400);
  await client(ctx, calendar.id).get(eventId).catch((e) => {
    if (notFound(e)) throw new AppError("not_found", "That event isn't on the band calendar anymore.", 404);
    googleError(e);
  });
  await db.update(ctx, kind, id, { calendarEventId: eventId, calendarHash: null });
  return { id, calendar: "linked" };
}

/** Send the event: update the one already there (or make it again if someone deleted it in Calendar), else create it. */
export async function calendarSend(ctx: Ctx, kind: CalendarKind, id: string): Promise<{ id: string; calendar: "created" | "updated" }> {
  const { doc, calendar, input, hash } = await build(ctx, kind, id);
  const cal = client(ctx, calendar.id);
  if (doc.calendarEventId) {
    try {
      await cal.update(doc.calendarEventId as string, input);
      await db.update(ctx, kind, id, { calendarHash: hash });
      return { id, calendar: "updated" };
    } catch (e) { if (!notFound(e)) googleError(e); }
  }
  const ev = await cal.create(input).catch(googleError);
  await db.update(ctx, kind, id, { calendarEventId: ev.id, calendarHash: hash });
  return { id, calendar: "created" };
}

/** Take the event off the band calendar. Already gone there is fine. */
export async function calendarRemove(ctx: Ctx, kind: CalendarKind, id: string): Promise<{ id: string; calendar: "removed" }> {
  const doc = await load(kind, id);
  if (doc.calendarEventId) {
    const artist = await artistOf(ctx, doc);
    const calendar = artist?.calendar as { id: string } | null | undefined;
    if (!calendar) throw new AppError("calendar_not_chosen", "No band calendar yet. An admin chooses it on Settings > Google.", 400);
    try { await client(ctx, calendar.id).delete(doc.calendarEventId as string); } catch (e) { if (!notFound(e)) googleError(e); }
  }
  await db.update(ctx, kind, id, { calendarEventId: null, calendarHash: null });
  return { id, calendar: "removed" };
}
