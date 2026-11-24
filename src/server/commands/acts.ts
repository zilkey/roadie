/**
 * Acts (issue #77): the bands on venue calendars, shared by every band, and this band's take on each (actNotes: shortlist,
 * relationship, note, contacts; `shortlist` is what the app calls Watch). Roadie gets all of these: finding acts, watching one, noting what they are to us.
 */
import { isLimit, spend } from "../usage";
import { z } from "zod";
import { defineCommand } from "./types";
import { SHARED_EDIT_NOTE } from "../platform";
import { patchInput } from "./util";
import { db, run } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { bandNotesBy, createNoted, updateNoted, withBandNote } from "../bandNotes";
import { ActInput, ACT_RELATIONSHIPS, RELATIONSHIP_LABEL, type ActRelationship } from "@/schema";
import { actListed, actStats, type ActFilter, type EvLike, type VenueLike } from "@/lib/acts";
import { dateInZone } from "@/lib/timezone";
import { zoneOf } from "../zone";
import { lookUpAct, type LookupResult } from "../assistant/actLookup";
import { findActTeam } from "../assistant/actTeam";

const ROLES = ["admin", "mcp"] as const;
const ActIn = ActInput.extend({ contactIds: z.array(z.string().min(1)).optional() });

/** Venue ids on this band's list: rooms it has notes, a pitch or a show at (the Booking list's "ours"). */
export async function ourVenueIds(ctx: Ctx): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const n of await db.list(ctx, "venueNotes")) if (!n.deletedAt) ids.add(n.venueId as string);
  for (const p of await db.list(ctx, "pitches")) if (p.target?.kind === "venue") ids.add(p.target.id as string);
  for (const s of await db.list(ctx, "shows")) if (s.venue?.id) ids.add(s.venue.id as string);
  return ids;
}

const FILTERS = ["shortlist", "opened", "tour", "all"] as const;

/** Every act with what the calendars say about it and this band's take, in list order (next show soonest, then name). */
export async function findActs(ctx: Ctx, f: { q?: string; filter: ActFilter; city?: string }) {
  const [acts, events, venues, notes, ours] = await Promise.all([
    db.list(ctx, "acts"), db.list(ctx, "venueEvents", undefined, { includeDeleted: true }), db.list(ctx, "venues"), bandNotesBy(ctx, "acts"), ourVenueIds(ctx),
  ]);
  const stats = actStats(events as unknown as EvLike[], new Map(venues.map((v) => [v.id, v as unknown as VenueLike])), ours, dateInZone(await zoneOf(ctx), ctx.now ?? new Date()));
  const rows = acts.map((a) => {
    const take = withBandNote("acts", { id: a.id }, notes.get(a.id));
    const s = stats.get(a.id);
    return { a, take, s };
  }).filter(({ a, take, s }) => actListed({ name: String(a.name) }, s, take, f));
  rows.sort((x, y) => (x.s?.next?.date ?? "9999").localeCompare(y.s?.next?.date ?? "9999") || String(x.a.name).localeCompare(String(y.a.name)));
  return rows;
}

export const actsFind = defineCommand({
  name: "acts.find", roles: [...ROLES],
  description:
    "Find acts: the bands on venue calendars' bills (shared by every band), plus any added by hand. Each row: the act (name, description, genres, hometown, links), " +
    "rooms (every venue it's on a calendar at, with headliner/support), next (its next show), openedAt (venue ids on our list where it played support), " +
    "tour (2+ Colorado rooms within four weeks, from today), cities, and this band's take: shortlist (true = we watch them; the app says Watch), relationship (openFor = bigger than us, we want to open for them; " +
    "cobill = Co-Bill: about our size, we trade shows; tourWith = we want to tour with them; notFit), note. filter: shortlist (the acts we watch) | opened (played support at rooms we play) | tour | all (default). q matches the name. " +
    "Not-a-fit acts are left out unless q names them. count is every match. Acts aren't in search: find an act by name here, with q.",
  input: z.strictObject({
    q: z.string().optional(), filter: z.enum(FILTERS).default("all"), city: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(5000).default(25),
  }),
  async run(ctx, i) {
    const rows = await findActs(ctx, i);
    const venueName = new Map((await db.list(ctx, "venues")).map((v) => [v.id, String(v.name)]));
    return {
      count: rows.length,
      rows: rows.slice(0, i.limit).map(({ a, take, s }) => ({
        id: a.id, name: a.name,
        ...(a.description ? { description: a.description } : {}), ...(a.genres ? { genres: a.genres } : {}), ...(a.hometown ? { hometown: a.hometown } : {}),
        ...(a.links ? { links: a.links } : {}), // An Instagram photo is a data URL (#78): kilobytes of base64 that mean nothing to Roadie.
        ...(a.imageUrl && !String(a.imageUrl).startsWith("data:") ? { imageUrl: a.imageUrl } : {}),
        rooms: s?.rooms ?? [], ...(s?.next ? { next: s.next } : {}),
        openedAt: s?.openedAt ?? [], openedAtNames: (s?.openedAt ?? []).map((id) => venueName.get(id) ?? id),
        tour: !!s?.tour, cities: s?.cities ?? [],
        shortlist: !!take.shortlist, ...(take.relationship ? { relationship: take.relationship, relationshipLabel: RELATIONSHIP_LABEL[take.relationship as ActRelationship] } : {}),
        ...(take.note ? { note: take.note } : {}), contactIds: take.contactIds ?? [],
      })),
    };
  },
});

export const actsCreate = defineCommand({
  name: "acts.create", roles: [...ROLES], input: ActIn,
  description: "Add an act by hand. Same name merges into the existing one. shortlist (Watch), relationship (openFor|cobill|tourWith|notFit), note and contactIds are this band's (other bands never see them); everything else is shared with every band.",
  run: (ctx, input) => run(ctx, (w) => createNoted(w, "acts", input)),
});

export const actsUpdate = defineCommand({
  name: "acts.update", roles: [...ROLES], input: patchInput(ActIn),
  description: "Edit an act: its shared facts (name, description, genres, hometown, lineup solo|band, links, imageUrl), or this band's shortlist (Watch), relationship (openFor|cobill|tourWith|notFit), note and contactIds. " +
    "weKnow: true when the band knows this act (\"we know those guys\", \"friends of ours\"), false to unmark; it is not a shortlist or a relationship. " +
    "note replaces the text: read first to add. contactIds replaces the list; link people with contacts.attach (kind acts)." + SHARED_EDIT_NOTE,
  run: (ctx, { id, patch }) => run(ctx, (w) => updateNoted(ctx, w, "acts", id, patch as Record<string, unknown>)),
});

export const actsShortlist = defineCommand({
  name: "acts.shortlist", roles: [...ROLES],
  description: "Watch an act (on: true; the app's Watch star, stored as the shortlist) or stop watching it (on: false), only when the person asks to watch, shortlist or star it. " +
    "Saying what an act is to us (bigger than us, a peer, not a fit) or a note is acts.note, not a watch. Find the act's id with acts.find.",
  input: z.strictObject({ id: z.string().min(1), on: z.boolean() }),
  run: (ctx, { id, on }) => run(ctx, (w) => updateNoted(ctx, w, "acts", id, { shortlist: on })),
});

export const actsNote = defineCommand({
  name: "acts.note", roles: [...ROLES],
  description:
    "Say what an act is to this band, privately: relationship openFor (bigger than us: we want to open for them), cobill (Co-Bill: about our size, we open for them, they open for us), tourWith (we want to go on tour with them) " +
    "or notFit (hidden from the Acts list), null clears it; and/or note, which replaces the note (read it with acts.find first to add to it; \"\" clears). Find the act's id with acts.find. " +
    "\"They're bigger than us\" or \"we'd love to open for them\" is relationship openFor alone: no note (unless they give one) and no watch (unless they ask).",
  input: z.strictObject({ id: z.string().min(1), relationship: z.enum(ACT_RELATIONSHIPS).nullable().optional(), note: z.string().nullable().optional() }),
  run: (ctx, { id, relationship, note }) => run(ctx, async (w) => {
    if (relationship === undefined && note === undefined) throw new AppError("invalid_input", "Say a relationship or a note", 400);
    return updateNoted(ctx, w, "acts", id, { ...(relationship !== undefined ? { relationship } : {}), ...(note !== undefined ? { note: note?.trim() || null } : {}) });
  }),
});

export const actsLookup = defineCommand({
  name: "acts.lookup", roles: ["admin"],
  description:
    "Look an act up on Spotify and the web (Google, through Gemini's search grounding) and fill its shared About facts where they are blank: links " +
    "(website, Instagram, Bandcamp, YouTube, Spotify; only links a search source shows), hometown, genres, description and photo. Sets lookedUpAt and sources. " +
    "When several Spotify artists share the name, it stores lookupCandidates and returns state \"pick\": call again with spotifyId (a candidate's id) " +
    "or spotifyId null (none of these). The act page's Look up button; not Roadie's.",
  input: z.strictObject({ id: z.string().min(1), spotifyId: z.string().min(1).nullable().optional() }),
  run: async (ctx, { id, spotifyId }) => { await spend(ctx, "webLookups"); return lookUpAct(ctx, id, { spotifyId }); },
});

// Look up is admin-only, not MCP's or Roadie's: it searches the web and Spotify on a click on the act page or the Acts page.

/** Acts looked up per click of "Look up watched acts": each one is a web search, an extraction and a Spotify search. */
export const SHORTLIST_LOOKUPS = 20;

export const actsLookupShortlist = defineCommand({
  name: "acts.lookupShortlist", roles: ["admin"],
  description: `Run acts.lookup for every act this band watches (the shortlist) that hasn't been looked up yet, ${SHORTLIST_LOOKUPS} at most per call (left says how many remain). The Acts page's "Look up watched acts" button.`,
  input: z.strictObject({}),
  async run(ctx) {
    const todo = (await findActs(ctx, { filter: "shortlist" })).filter(({ a }) => !a.lookedUpAt && !a.lookupCandidates).map(({ a }) => a.id);
    const results: LookupResult[] = [];
    const failed: string[] = [];
    const batch = todo.slice(0, SHORTLIST_LOOKUPS);
    // Three at a time: quick enough for a click, gentle on the model and Spotify's rate limit. Each is a web lookup (daily limit):
    // past the limit the rest wait for tomorrow (left), unless none was done, which is the limit's 429.
    let tried = 0;
    for (let i = 0; i < batch.length; i += 3) {
      const chunk = batch.slice(i, i + 3);
      try { await spend(ctx, "webLookups", chunk.length); } catch (e) { if (isLimit(e) && tried) break; throw e; }
      tried += chunk.length;
      const done = await Promise.allSettled(batch.slice(i, i + 3).map((id) => lookUpAct(ctx, id)));
      done.forEach((d, j) => { if (d.status === "fulfilled") results.push(d.value); else { failed.push(batch[i + j]); console.error("acts.lookupShortlist", batch[i + j], d.reason); } });
    }
    return {
      lookedUp: results.length, found: results.filter((r) => r.state === "found").length, pick: results.filter((r) => r.state === "pick").length,
      nothing: results.filter((r) => r.state === "nothing").length, failed: failed.length, left: Math.max(0, todo.length - tried), results,
    };
  },
});

export const actsFindTeam = defineCommand({
  name: "acts.findTeam", roles: ["admin"],
  description:
    "Look for an act's team: booking agent, manager, publicist, label and general inbox, from the act's own website (its contact, booking, " +
    "about and press pages), its Bandcamp, and a Google search (Gemini's grounding) with the pages it came from. An email is returned only when " +
    "it is written on a page that was read. Then one more search per named person for their own email, phone and LinkedIn (kept only when " +
    "a page names them). Saves nothing: the act page's \"Find their team\" button lists people, each with an Add button that saves them " +
    "with a note on how they were found.",
  input: z.strictObject({ id: z.string().min(1) }),
  run: async (ctx, { id }) => { await spend(ctx, "webLookups"); return findActTeam(ctx, id); },
});

export const actCommands = [actsFind, actsCreate, actsUpdate, actsShortlist, actsNote, actsLookup, actsLookupShortlist, actsFindTeam];
