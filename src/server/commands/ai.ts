/**
 * Read tools for AI (MCP) plus the safety-net commands: history undo and AI keys.
 * Everything here that reads returns plain JSON; writes go through db.ts like every other command.
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { db } from "../db";
import { AppError } from "../errors";
import { bandsintownClient } from "../integrations";
import { undoRun, runsOf } from "../undo";
import { buildSearchItems, searchItems, isActive, todayStr } from "@/lib/booking";
import { statsMovement, type StatLike } from "@/lib/stats";
import { bandsintownEligible } from "../showSync";
import { bandmates } from "../music";
import { callerArtistId, notesByVenue, privateOf, withNotes } from "../venues";
import { dateStr } from "@/schema";
import { isOff, publicShowName, showName, type ShowPlaceLike, isPublished } from "@/lib/shows";

const READ = ["admin", "mcp"] as const;
const strict = z.strictObject;

// ---------- search ----------

const SEARCH_KINDS = ["venue", "promoter", "festival", "edition", "contact", "pitch"] as const;

export const search = defineCommand({
  name: "search", roles: [...READ],
  description:
    "Search booking records by name, city or person, including a contact's email (every word must match): venues, promoters, festivals, festival editions (years), contacts and pitches. " +
    "Returns {kind, id, name, sub} rows; use records.get with the id for the whole record. Search before creating anything so you do not make duplicates.",
  input: strict({ q: z.string().min(1), kinds: z.array(z.enum(SEARCH_KINDS)).optional(), limit: z.number().int().min(1).max(100).default(25) }),
  async run(ctx, i) {
    const [allVenues, promoters, festivals, contacts, editions, pitches] = await Promise.all(
      ["venues", "promoters", "festivals", "contacts", "editions", "pitches"].map((c) => db.list(c)),
    );
    // The shared directory with this band's notes laid over it (their contacts are searchable); a room the band archived is hidden.
    const notes = ctx.role === "member" ? new Map() : await notesByVenue(await callerArtistId(ctx));
    const venues = allVenues.filter((v) => !notes.get(v.id)?.deletedAt).map((v) => withNotes(v, notes.get(v.id) ?? null));
    const items = buildSearchItems({ venues, promoters, festivals, contacts } as never) as { kind: string; id: string; name: string; sub: string; haystack: string }[];
    for (const e of editions) items.push({ kind: "edition", id: e.id, name: `${e.festivalName} ${e.label}`, sub: ["Festival year", e.appDeadline?.date && `deadline ${e.appDeadline.date}`].filter(Boolean).join(" · "), haystack: `${e.festivalName} ${e.label} ${e.year}` });
    for (const p of pitches.filter((p) => inArtist(ctx, "pitches", p))) items.push({ kind: "pitch", id: p.id, name: p.target.name, sub: `Pitch · ${p.status}`, haystack: `${p.target.name} ${p.status} ${p.notes ?? ""}` });
    const want = new Set<string>(i.kinds ?? SEARCH_KINDS);
    const hits = searchItems(items as never, i.q).filter((x) => want.has(x.kind)).slice(0, i.limit);
    return { count: hits.length, results: hits.map(({ kind, id, name, sub }) => ({ kind, id, name, sub })) };
  },
});

// ---------- records.get / records.list ----------

/** What an AI may read. Not users, AI keys or history. Musicians are whole for admins (contact details, userId); mcp gets names and ids only. */
const READABLE = [
  "venues", "promoters", "festivals", "editions", "contacts", "pitches", "emailTemplates", "shows", "showDeals", "availability",
  "checklistTemplates", "setlistTemplates", "songs", "files", "setlists", "stagePlots", "rehearsals", "expenses", "statSnapshots", "artists", "musicians",
] as const;
const kindEnum = z.enum(READABLE);

function present(ctx: { role: string }, kind: string, d: Record<string, unknown>) {
  const o = { ...d };
  if (kind === "availability") delete o.linkTokens;
  if (kind === "stagePlots") o.share = { on: !!(o.share as { on?: boolean } | undefined)?.on };
  if (kind === "musicians" && ctx.role === "admin") return { id: o.id, name: o.name, instruments: o.instruments, active: o.active, archivedAt: o.archivedAt, email: o.email, phone: o.phone, payHandle: o.payHandle, userId: o.userId };
  if (kind === "musicians") return { id: o.id, name: o.name, instruments: o.instruments, active: o.active };
  return o;
}

/**
 * Records that say whose they are (an artist itself; shows and pitches carry artistId) are only visible from that artist.
 * Everything else isn't partitioned by artist yet (one band per project today), so it is visible to every member.
 */
function inArtist(ctx: { artistId?: string }, kind: string, d: Record<string, unknown>) {
  if (!ctx.artistId) return true;
  if (kind === "artists") return d.id === ctx.artistId;
  if (kind === "shows" || kind === "pitches") return !d.artistId || d.artistId === ctx.artistId;
  return true;
}

export const recordsGet = defineCommand({
  name: "records.get", roles: [...READ],
  description:
    "Read one record by kind and id (kinds: " + READABLE.join(", ") + "). A pitch also includes its timeline and comments; a show, the comments carried over from its pitch. " +
    "A venue includes this band's notes (and archived: true if the band hid it). Musicians include phone, email, pay handle and userId for admins (names only through MCP). showDeals and setlists have the same id as their show.",
  input: strict({ kind: kindEnum, id: z.string().min(1) }),
  async run(ctx, i) {
    const d = await db.get(i.kind, i.id);
    if (!d || d.deletedAt || !inArtist(ctx, i.kind, d)) throw new AppError("not_found", `${i.kind}/${i.id} not found`, 404);
    const out: Record<string, unknown> = present(ctx, i.kind, d);
    if (i.kind === "venues") {
      // The shared room plus this band's private notes (loadInNotes, notes, contactIds, promoterIds). Never another band's.
      const note = (await notesByVenue(await callerArtistId(ctx))).get(d.id) ?? null;
      Object.assign(out, withNotes(d, note));
      if (note?.deletedAt) out.archived = true;
    }
    if (i.kind === "pitches") {
      out.activity = (await db.list(`pitches/${i.id}/activity`)).sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
      out.comments = (await db.list(`pitches/${i.id}/comments`)).sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
    }
    if (i.kind === "shows") out.comments = (await db.list(`shows/${i.id}/comments`)).sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
    return out;
  },
});

/** A dotted path into a record ("address.city"). */
const at = (d: Record<string, any>, path: string): unknown => path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), d); // eslint-disable-line @typescript-eslint/no-explicit-any
const isEmpty = (v: unknown) => v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);

export const recordsList = defineCommand({
  name: "records.list", roles: [...READ],
  description:
    "List records of one kind (newest changes first), live ones only. Use search to find specific ones. Optional filters, combined with AND: " +
    "showId (expenses of a show; availability asks for a show), pitchId (availability asks for a pitch), rehearsalId, " +
    "status (e.g. the Pitch List by status; pitch rows include every status, not just active ones), venueId (pitches or shows at a venue), " +
    "missing (dotted field paths that are empty, e.g. [\"address.city\"] for venues with no city). count is every match, however small limit is: " +
    "for \"how many\" questions pass limit 1, and fields (e.g. [\"name\"]) to keep long lists short.",
  input: strict({
    kind: kindEnum, limit: z.number().int().min(1).max(200).default(50),
    showId: z.string().min(1).optional(), rehearsalId: z.string().min(1).optional(), pitchId: z.string().min(1).optional(),
    status: z.string().min(1).optional(), venueId: z.string().min(1).optional(),
    missing: z.array(z.string().min(1)).optional(), fields: z.array(z.string().min(1)).optional(),
  }),
  async run(ctx, i) {
    let rows = (await db.list(i.kind)).filter((d) => inArtist(ctx, i.kind, d));
    if (i.kind === "venues") {
      const notes = await notesByVenue(await callerArtistId(ctx));
      rows = rows.filter((v) => !notes.get(v.id)?.deletedAt).map((v) => withNotes(v, notes.get(v.id) ?? null));
    }
    const venueOf = (d: Record<string, any>) => (i.kind === "shows" ? d.venue?.id : i.kind === "pitches" ? (d.target?.kind === "venue" ? d.target.id : undefined) : d.venueId);
    if (i.showId) rows = rows.filter((d) => d.showId === i.showId);
    if (i.rehearsalId) rows = rows.filter((d) => d.rehearsalId === i.rehearsalId);
    if (i.pitchId) rows = rows.filter((d) => d.pitchId === i.pitchId);
    if (i.status) rows = rows.filter((d) => d.status === i.status);
    if (i.venueId) rows = rows.filter((d) => venueOf(d) === i.venueId);
    if (i.missing?.length) rows = rows.filter((d) => i.missing!.every((f) => isEmpty(at(d, f))));
    rows = rows.sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
    const shown = rows.slice(0, i.limit).map((r) => present(ctx, i.kind, r));
    return { count: rows.length, rows: i.fields?.length ? shown.map((r) => Object.fromEntries(["id", ...i.fields!].map((f) => [f, at(r, f) ?? null]))) : shown };
  },
});

// ---------- pitches.needingFollowUp ----------

export const pitchesNeedingFollowUp = defineCommand({
  name: "pitches.needingFollowUp", roles: [...READ],
  description:
    "Active pitches that need a nudge: next step due or overdue, or pitched/waiting with no contact for `quietDays` (default 10). " +
    "Returns the pitch, why, days since last contact, and the people on the venue/promoter/festival with emails, ready for pitches.draftEmail.",
  input: strict({ quietDays: z.number().int().min(1).default(10), today: dateStr.optional() }),
  async run(ctx, i) {
    const today = i.today ?? todayStr();
    const day = (ms: number) => Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(new Date(ms).toISOString().slice(0, 10) + "T00:00:00Z")) / 86_400_000);
    const pitches = (await db.list("pitches")).filter((p) => isActive(p.status) && inArtist(ctx, "pitches", p));
    const contacts = new Map((await db.list("contacts")).map((c) => [c.id, c]));
    const out = [];
    for (const p of pitches) {
      const reasons: string[] = [];
      if (p.nextStep?.due && p.nextStep.due <= today) reasons.push(`Next step "${p.nextStep.text}" was due ${p.nextStep.due}`);
      const last = (p.lastContactAt ?? p.createdAt)?.toMillis?.() as number | undefined;
      const quiet = last ? day(last) : undefined;
      if ((p.status === "pitched" || p.status === "waiting") && quiet !== undefined && quiet >= i.quietDays) reasons.push(`No contact for ${quiet} days`);
      if (!reasons.length) continue;
      const kind = p.target.kind as string;
      const target = await db.get(kind === "venue" ? "venues" : kind === "promoter" ? "promoters" : "editions", p.target.id);
      let contactIds: string[] = kind === "venue" && target ? privateOf((await notesByVenue(await callerArtistId(ctx))).get(target.id) ?? target).contactIds : (target?.contactIds as string[]) ?? [];
      if (kind === "edition" && target?.festivalId) contactIds = ((await db.get("festivals", target.festivalId))?.contactIds as string[]) ?? [];
      out.push({
        id: p.id, target: p.target, status: p.status, nextStep: p.nextStep ?? null, daysSinceContact: quiet ?? null, reasons,
        people: contactIds.map((c) => contacts.get(c)).filter(Boolean).map((c) => ({ id: c!.id, name: c!.name, title: c!.title, emails: c!.emails })),
      });
    }
    out.sort((a, b) => (b.daysSinceContact ?? 0) - (a.daysSinceContact ?? 0));
    return { today, count: out.length, pitches: out };
  },
});

// ---------- songs.missingFiles ----------

export const songsMissingFiles = defineCommand({
  name: "songs.missingFiles", roles: [...READ],
  description:
    "Songs (not retired) with no attached Drive file, which kinds each song has, and every attached file with a sharing problem: " +
    "who cannot open it, or it sits outside the band folder. Follow up with drive.search, files.attach, files.shareWithBand, files.copyToBand.",
  input: strict({ includeIdeas: z.boolean().default(false) }),
  async run(_ctx, i) {
    const [songs, files, mates] = await Promise.all([db.list("songs"), db.list("files"), bandmates()]);
    const name = new Map(mates.map((m) => [m.id, m.name]));
    const live = songs.filter((s) => s.status !== "retired" && (i.includeIdeas || s.status !== "idea"));
    const byTitle = new Map(songs.map((s) => [s.id, s.title as string]));
    const kindsOf = (id: string) => [...new Set(files.filter((f) => f.songId === id).map((f) => f.kind as string))];
    return {
      songsWithoutFiles: live.filter((s) => !files.some((f) => f.songId === s.id)).map((s) => ({ id: s.id, title: s.title, status: s.status, key: s.key ?? null })),
      songsWithoutChart: live.filter((s) => !kindsOf(s.id).includes("chart")).map((s) => ({ id: s.id, title: s.title })),
      songsWithoutDemo: live.filter((s) => !kindsOf(s.id).some((k) => k === "demo" || k === "recording")).map((s) => ({ id: s.id, title: s.title })),
      // Only files that have actually been looked up in Drive. An imported file has a driveFileId but no sharing or
      // inBandFolder yet: that is "not checked", not a problem to report, and reading the unset sharing would throw.
      sharingProblems: files.filter((f) => f.driveFileId && f.sharing !== undefined && f.inBandFolder !== undefined
        && (f.sharing !== "ok" || !f.inBandFolder)).map((f) => ({
        fileId: f.id, title: f.title, kind: f.kind, song: f.songId ? byTitle.get(f.songId) ?? null : null, url: f.url,
        cannotOpen: f.sharing === "ok" ? [] : ((f.sharing as { missing: string[] }).missing).map((m) => ({ musicianId: m, name: name.get(m) ?? m })),
        outsideBandFolder: !f.inBandFolder,
      })),
    };
  },
});

// ---------- availability.check ----------

export const availabilityCheck = defineCommand({
  name: "availability.check", roles: [...READ],
  description:
    "For each date: shows already on it (holds and confirmed), 'Can you play?' questions with who answered what and who has not, and a verdict " +
    "(conflict = a confirmed or hold show that day; asked = a question is open; free = nothing). Use before pitching dates.",
  input: strict({ dates: z.array(dateStr).min(1).max(60) }),
  async run(_ctx, i) {
    const [shows, asks, musicians] = await Promise.all([db.list("shows"), db.list("availability"), db.list("musicians")]);
    const name = new Map(musicians.map((m) => [m.id, m.name as string]));
    return {
      dates: [...new Set(i.dates)].sort().map((date) => {
        const onDay = shows.filter((s) => s.date === date && !isOff(s));
        const qs = asks.filter((a) => a.date === date).map((a) => ({
          id: a.id, label: a.label, closed: !!a.closedAt,
          answers: Object.fromEntries(Object.entries(a.responses as Record<string, { answer: string }>).map(([m, r]) => [name.get(m) ?? m, r.answer])),
          waitingOn: (a.askedMusicianIds as string[]).filter((m) => !a.responses?.[m]).map((m) => name.get(m) ?? m),
        }));
        const conflict = onDay.some((s) => s.status === "confirmed" || s.status === "hold" || s.status === "played");
        return {
          date, verdict: conflict ? "conflict" : qs.some((q) => !q.closed) ? "asked" : "free",
          shows: onDay.map((s) => ({ id: s.id, venue: showName(s as ShowPlaceLike), status: s.status })), asks: qs,
        };
      }),
    };
  },
});

// ---------- bandsintown.reconcile ----------

export const bandsintownReconcile = defineCommand({
  name: "bandsintown.reconcile", roles: [...READ],
  description:
    "Compare our shows with what Bandsintown lists. Reports: confirmed published upcoming shows not listed (fix with shows.sync), listings with no matching eligible show " +
    "(holds, unpublished, canceled, dropped or unknown), and listings whose date, time, venue or ticket link differ from the show.",
  input: strict({ today: dateStr.optional() }),
  async run(ctx, i) {
    const today = i.today ?? todayStr();
    const [shows, events] = await Promise.all([db.list("shows"), bandsintownClient().list()]);
    const byId = new Map(events.map((e) => [e.id, e]));
    const matched = new Set<string>();
    const missing: unknown[] = [], mismatches: unknown[] = [];
    let ok = 0;
    const upcoming = shows.filter((s) => s.date >= today);
    for (const s of upcoming.filter(bandsintownEligible)) {
      const t = s.times as { set?: string; doors?: string };
      const want = { datetime: `${s.date}T${t.set ?? t.doors ?? "20:00"}:00`, venueName: publicShowName(s as ShowPlaceLike), ticketUrl: (s.ticketUrl as string | undefined) ?? undefined };
      const linked = s.listings?.bandsintown?.eventId as string | undefined;
      const ev = (linked && byId.get(linked)) || events.find((e) => !matched.has(e.id) && e.datetime.slice(0, 10) === s.date && e.venueName === want.venueName);
      if (!ev) { missing.push({ showId: s.id, date: s.date, venue: want.venueName, state: s.listings?.bandsintown?.state ?? "not listed" }); continue; }
      matched.add(ev.id);
      const diffs: Record<string, { show: unknown; bandsintown: unknown }> = {};
      if (ev.datetime.slice(0, 16) !== want.datetime.slice(0, 16)) diffs.datetime = { show: want.datetime, bandsintown: ev.datetime };
      if (ev.venueName !== want.venueName) diffs.venueName = { show: want.venueName, bandsintown: ev.venueName };
      if ((ev.ticketUrl ?? undefined) !== want.ticketUrl) diffs.ticketUrl = { show: want.ticketUrl ?? null, bandsintown: ev.ticketUrl ?? null };
      if (Object.keys(diffs).length) mismatches.push({ showId: s.id, eventId: ev.id, diffs }); else ok++;
    }
    const unexpected = events.filter((e) => !matched.has(e.id)).map((e) => {
      const s = shows.find((x) => x.listings?.bandsintown?.eventId === e.id) ?? shows.find((x) => x.date === e.datetime.slice(0, 10) && publicShowName(x as ShowPlaceLike) === e.venueName);
      return { eventId: e.id, datetime: e.datetime, venue: e.venueName, showId: s?.id ?? null, why: !s ? "No show matches" : s.deletedAt ? "Show is archived" : s.status === "played" ? "Played show (history)" : !isPublished(s) ? "Show isn't published to Bandsintown" : s.status !== "confirmed" ? `Show is ${s.status}` : "Show is eligible but this listing does not match it" };
    }).filter((u) => u.why !== "Played show (history)");
    return { today, ok, missingOnBandsintown: missing, notExpected: unexpected, mismatches };
  },
});

// ---------- stats.movement ----------

export const statsMovementCmd = defineCommand({
  name: "stats.movement", roles: [...READ],
  description:
    "How followers, monthly listeners, streams and popularity moved from the day of each event to `windowDays` after (default 14). " +
    "Events are your played/confirmed shows plus the `releases` you pass in ({name, date}; the app has no release records). Missing snapshots are reported as missing, not guessed.",
  input: strict({
    releases: z.array(strict({ name: z.string().min(1), date: dateStr })).default([]),
    windowDays: z.number().int().min(1).max(90).default(14),
    includeShows: z.boolean().default(true), today: dateStr.optional(),
  }),
  async run(ctx, i) {
    const today = i.today ?? todayStr();
    const [snaps, shows] = await Promise.all([db.list("statSnapshots"), db.list("shows")]);
    const s = snaps as unknown as StatLike[];
    const events = [
      ...i.releases.map((r) => ({ type: "release", name: r.name, date: r.date })),
      ...(i.includeShows ? shows.filter((x) => x.date <= today && (x.status === "played" || x.status === "confirmed")).map((x) => ({ type: "show", name: showName(x as ShowPlaceLike), date: x.date as string, id: x.id as string })) : []),
    ].sort((a, b) => a.date.localeCompare(b.date));
    return { windowDays: i.windowDays, events: events.map((e) => ({ ...e, movement: statsMovement(s, e.date, i.windowDays) })) };
  },
});

// ---------- history: undo ----------

export const historyUndoRun = defineCommand({
  name: "history.undoRun", roles: [...READ],
  description:
    "Undo everything one run changed, newest first: created records are archived, edits go back to their earlier values, archived records come back. " +
    "Each reversal is recorded as a new run (undo that to redo). Ledger entries are not touched and are listed as needing a correction. Email, calendar and Bandsintown effects are not undone. " +
    "Through MCP you may only undo runs you made yourself (see history.myRuns).",
  input: strict({ runId: z.string().min(1) }),
  run: (ctx, i) => undoRun(ctx, i.runId, ctx.role === "mcp" ? { ownerUid: ctx.uid } : {}),
});

export const historyMyRuns = defineCommand({
  name: "history.myRuns", roles: [...READ],
  description: "Your recent runs (newest first) with how many changes each made, so you can pick one for history.undoRun.",
  input: strict({ limit: z.number().int().min(1).max(100).default(20) }),
  run: async (ctx, i) => ({ runs: await runsOf(ctx.uid, i.limit), currentRunId: ctx.runId }),
});

export const aiCommands = [
  search, recordsGet, recordsList, pitchesNeedingFollowUp, songsMissingFiles, availabilityCheck, bandsintownReconcile, statsMovementCmd,
  historyUndoRun, historyMyRuns,
];
