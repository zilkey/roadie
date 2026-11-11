/**
 * Acts (issue #77): the bands on venue calendars, shared by every band, and this band's take on each (actNotes: shortlist,
 * relationship, note, contacts). Roadie gets all of these: finding acts, shortlisting one, noting what they are to us.
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { patchInput } from "./util";
import { db, run } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { callerArtistId } from "../venues";
import { bandNotesBy, createNoted, updateNoted, withBandNote } from "../bandNotes";
import { ActInput, ACT_RELATIONSHIPS, RELATIONSHIP_LABEL, type ActRelationship } from "@/schema";
import { actListed, actStats, type ActFilter, type EvLike, type VenueLike } from "@/lib/acts";
import { dateInBandZone } from "@/lib/timezone";

const ROLES = ["admin", "mcp"] as const;
const ActIn = ActInput.extend({ contactIds: z.array(z.string().min(1)).optional() });

/** Venue ids on this band's list: rooms it has notes, a pitch or a show at (the Booking list's "ours"). */
export async function ourVenueIds(artistId: string | undefined): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!artistId) return ids;
  for (const n of await db.list("venueNotes", (q) => q.where("artistId", "==", artistId))) if (!n.deletedAt) ids.add(n.venueId as string);
  for (const p of await db.list("pitches", (q) => q.where("artistId", "==", artistId))) if (p.target?.kind === "venue") ids.add(p.target.id as string);
  for (const s of await db.list("shows")) if ((!s.artistId || s.artistId === artistId) && s.venue?.id) ids.add(s.venue.id as string);
  return ids;
}

const FILTERS = ["shortlist", "opened", "tour", "all"] as const;

/** Every act with what the calendars say about it and this band's take, in list order (next show soonest, then name). */
export async function findActs(ctx: Ctx, f: { q?: string; filter: ActFilter; city?: string }) {
  const artistId = await callerArtistId(ctx);
  const [acts, events, venues, notes, ours] = await Promise.all([
    db.list("acts"), db.list("venueEvents", undefined, { includeDeleted: true }), db.list("venues"), bandNotesBy("acts", artistId), ourVenueIds(artistId),
  ]);
  const stats = actStats(events as unknown as EvLike[], new Map(venues.map((v) => [v.id, v as unknown as VenueLike])), ours, dateInBandZone());
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
    "tour (2+ Colorado rooms within four weeks, from today), cities, and this band's take: shortlist, relationship (openFor = bigger than us, we want to open for them; " +
    "peer = about our size, trade shows; notFit), note. filter: shortlist | opened (played support at rooms we play) | tour | all (default). q matches the name. " +
    "Not-a-fit acts are left out unless q names them. count is every match.",
  input: z.strictObject({
    q: z.string().optional(), filter: z.enum(FILTERS).default("all"), city: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(5000).default(25),
  }),
  async run(ctx, i) {
    const rows = await findActs(ctx, i);
    const venueName = new Map((await db.list("venues")).map((v) => [v.id, String(v.name)]));
    return {
      count: rows.length,
      rows: rows.slice(0, i.limit).map(({ a, take, s }) => ({
        id: a.id, name: a.name,
        ...(a.description ? { description: a.description } : {}), ...(a.genres ? { genres: a.genres } : {}), ...(a.hometown ? { hometown: a.hometown } : {}),
        ...(a.links ? { links: a.links } : {}), ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}),
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
  description: "Add an act by hand. Same name merges into the existing one. shortlist, relationship (openFor|peer|notFit), note and contactIds are this band's (other bands never see them); everything else is shared with every band.",
  run: (ctx, input) => run(ctx, (w) => createNoted(w, "acts", input)),
});

export const actsUpdate = defineCommand({
  name: "acts.update", roles: [...ROLES], input: patchInput(ActIn),
  description: "Edit an act: its shared facts (name, description, genres, hometown, links, imageUrl), or this band's shortlist, relationship (openFor|peer|notFit), note and contactIds. " +
    "note replaces the text: read first to add. contactIds replaces the list; link people with contacts.attach (kind acts).",
  run: (ctx, { id, patch }) => run(ctx, (w) => updateNoted(ctx, w, "acts", id, patch as Record<string, unknown>)),
});

export const actsShortlist = defineCommand({
  name: "acts.shortlist", roles: [...ROLES],
  description: "Put an act on this band's shortlist (on: true) or take it off (on: false). Find the act's id with acts.find.",
  input: z.strictObject({ id: z.string().min(1), on: z.boolean() }),
  run: (ctx, { id, on }) => run(ctx, (w) => updateNoted(ctx, w, "acts", id, { shortlist: on })),
});

export const actsNote = defineCommand({
  name: "acts.note", roles: [...ROLES],
  description:
    "Say what an act is to this band, privately: relationship openFor (bigger than us: we want to open for them), peer (about our size: we open for them, they open for us) " +
    "or notFit (hidden from the Acts list), null clears it; and/or note, which replaces the note (read it with acts.find first to add to it; \"\" clears). Find the act's id with acts.find.",
  input: z.strictObject({ id: z.string().min(1), relationship: z.enum(ACT_RELATIONSHIPS).nullable().optional(), note: z.string().nullable().optional() }),
  run: (ctx, { id, relationship, note }) => run(ctx, async (w) => {
    if (relationship === undefined && note === undefined) throw new AppError("invalid_input", "Say a relationship or a note", 400);
    return updateNoted(ctx, w, "acts", id, { ...(relationship !== undefined ? { relationship } : {}), ...(note !== undefined ? { note: note?.trim() || null } : {}) });
  }),
});

export const actCommands = [actsFind, actsCreate, actsUpdate, actsShortlist, actsNote];
