/**
 * Fans (story 31, F4/F5/F9). Admins see every address; members, and AI callers who are not admins, only counts
 * (fans.counts, fans.near, fans.newSince), never an email, name or row. The public signup lives in src/server/fans.ts.
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { idInput } from "./util";
import { db, run, type Doc } from "../db";
import { AppError } from "../errors";
import {
  artistShows, canSeeFans, citiesFor, countableShow, deleteFan, fanArtistId, loadFans, requireFan, requireFanAdmin, showLabel, upsertFan,
} from "../fans";
import { geocodeCity, geocodeText } from "../geocode";
import { dateInBandZone } from "@/lib/timezone";
import { NO_CITY, cityLabel, groupOf, haversineMiles, mergeCities, sameCity, type CityLike } from "@/lib/fans";
import { dateStr } from "@/schema";

const ADMIN_ONLY = ["admin", "mcp"] as const;
const COUNTS = ["admin", "member", "mcp"] as const;
const strict = <T extends z.ZodRawShape>(s: T) => z.strictObject(s);
const iso = (v: unknown) => (v && typeof (v as { toDate?: () => Date }).toDate === "function" ? (v as { toDate(): Date }).toDate().toISOString() : null);
const inBandzoogle = (f: Doc) => !!f.bandzoogle?.addedAt;

/** What an admin sees of a fan. Coordinates stay internal. */
const present = (f: Doc) => ({
  id: f.id, email: f.email, firstName: f.firstName ?? null,
  cities: ((f.cities ?? []) as CityLike[]).map((c) => ({ city: c.city, ...(c.state ? { state: c.state } : {}) })),
  showIds: (f.showIds ?? []) as string[], source: f.source as string, addedAt: iso(f.createdAt), lastSeenAt: iso(f.lastSeenAt),
  bandzoogle: f.bandzoogle ? { addedAt: iso(f.bandzoogle.addedAt), group: f.bandzoogle.group as string } : null,
});

const cityInput = { city: z.string().trim().min(1).max(80), state: z.string().trim().max(40).optional() };
const email = z.string().trim().toLowerCase().max(254).pipe(z.string().email());

// ---------- add / update / remove ----------

export const fansAdd = defineCommand({
  name: "fans.add", roles: [...ADMIN_ONLY],
  description:
    "Add a fan from a paper signup sheet (admins only; source \"paper\"). email is required; firstName, a typed city (and state) and the show they signed up at are optional. " +
    "With a showId and no city, the city is that show's town. An address already on the list is merged into (cities and shows added), never duplicated. Returns {id, created}.",
  input: strict({ email, firstName: z.string().trim().max(60).optional(), city: cityInput.city.optional(), state: cityInput.state, showId: z.string().min(1).optional() }),
  async run(ctx, i) {
    const artistId = await requireFanAdmin(ctx);
    const show = i.showId ? await countableShow(artistId, i.showId) : undefined;
    const typed = i.city ? await citiesFor(undefined, { city: i.city, state: i.state }) : [];
    const fromShow = show && !typed.length ? await citiesFor(show) : [];
    return upsertFan(ctx, {
      artistId, email: i.email, ...(i.firstName ? { firstName: i.firstName } : {}),
      cities: [...fromShow, ...typed], showIds: show ? [show.id] : [], source: "paper",
    });
  },
});

export const fansUpdate = defineCommand({
  name: "fans.update", roles: [...ADMIN_ONLY],
  description:
    "Change a fan (admins only): firstName (null clears it), cities (the whole list, each {city, state?}; new ones are geocoded) and showIds. The email can't change: remove the fan and add the new address.",
  input: strict({
    id: z.string().min(1),
    patch: strict({
      firstName: z.string().trim().max(60).nullable().optional(),
      cities: z.array(strict(cityInput)).max(50).optional(),
      showIds: z.array(z.string().min(1)).max(200).optional(),
    }),
  }),
  async run(ctx, { id, patch }) {
    const artistId = await requireFanAdmin(ctx);
    const before = await db.get("fans", id);
    if (!before || before.deletedAt || before.artistId !== artistId) throw new AppError("not_found", "Fan not found", 404);
    let cities: CityLike[] | undefined;
    if (patch.cities) {
      const old = (before.cities ?? []) as CityLike[];
      cities = [];
      for (const c of patch.cities) {
        const had = old.find((o) => sameCity(o, c) && o.lat !== undefined);
        const hit = had ? { lat: had.lat!, lng: had.lng! } : await geocodeCity(c);
        cities = mergeCities(cities, [{ city: c.city, ...(c.state ? { state: c.state.toUpperCase() } : {}), ...(hit ?? {}) }]);
      }
    }
    if (patch.showIds) for (const s of patch.showIds) if (!before.showIds?.includes(s)) await countableShow(artistId, s);
    return run(ctx, async (w) => {
      await requireFan(w, id, artistId);
      return w.update("fans", id, {
        ...(patch.firstName !== undefined ? { firstName: patch.firstName || null } : {}),
        ...(cities ? { cities } : {}),
        ...(patch.showIds ? { showIds: [...new Set(patch.showIds)] } : {}),
      });
    });
  },
});

export const fansRemove = defineCommand({
  name: "fans.remove", roles: [...ADMIN_ONLY], input: idInput,
  description: "Delete a fan for good (admins only; hard delete, with their change history, e.g. when someone asks to be taken off). It can't be undone.",
  async run(ctx, { id }) {
    const artistId = await requireFanAdmin(ctx);
    await deleteFan(artistId, id);
    return { id, removed: true };
  },
});

// ---------- reading ----------

export const fansList = defineCommand({
  name: "fans.list", roles: [...ADMIN_ONLY],
  description:
    "List fans with their email, first name, cities, shows, source (list|paper), when they were added and their Bandzoogle stamp (admins only; everyone else uses fans.counts). " +
    "Optional filters, ANDed: showId, city (\"Boise\" or \"Boise, ID\", any case), notInBandzoogle. Newest first, up to limit (default 200); count is every match.",
  input: strict({
    showId: z.string().min(1).optional(), city: z.string().trim().min(1).optional(), notInBandzoogle: z.boolean().optional(),
    limit: z.number().int().min(1).max(1000).default(200),
  }),
  async run(ctx, i) {
    const artistId = await requireFanAdmin(ctx);
    const want = i.city ? (await citiesFor(undefined, { city: i.city }))[0] : undefined;
    const rows = (await loadFans(artistId))
      .filter((f) => !i.showId || (f.showIds ?? []).includes(i.showId))
      .filter((f) => !want || ((f.cities ?? []) as CityLike[]).some((c) => sameCity(c, want)))
      .filter((f) => !i.notInBandzoogle || !inBandzoogle(f))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    return { count: rows.length, fans: rows.slice(0, i.limit).map(present) };
  },
});

const tally = (m: Map<string, number>) => Object.fromEntries([...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));

export const fansCounts = defineCommand({
  name: "fans.counts", roles: [...COUNTS],
  description:
    "How many fans are on the list, with no addresses or names: total, byCity (\"City, ST\" -> fans; a fan counts once under each city they signed up from, \"No city\" for none), " +
    "byShow ([{showId, label, count}]), notInBandzoogle, and newSince (fans added on or after the optional since date, YYYY-MM-DD). Open to every role.",
  input: strict({ since: dateStr.optional() }),
  async run(ctx, i) {
    const artistId = await fanArtistId(ctx);
    const fans = await loadFans(artistId);
    const byCity = new Map<string, number>(), byShow = new Map<string, number>();
    for (const f of fans) {
      const cs = (f.cities ?? []) as CityLike[];
      for (const k of new Set(cs.length ? cs.map(cityLabel) : [NO_CITY])) byCity.set(k, (byCity.get(k) ?? 0) + 1);
      for (const s of new Set((f.showIds ?? []) as string[])) byShow.set(s, (byShow.get(s) ?? 0) + 1);
    }
    const shows = new Map((await artistShows(artistId)).map((s) => [s.id, s]));
    return {
      total: fans.length,
      byCity: tally(byCity),
      byShow: [...byShow].map(([showId, count]) => ({ showId, label: shows.has(showId) ? `${showLabel(shows.get(showId)!)} · ${shows.get(showId)!.date}` : "Deleted show", count }))
        .sort((a, b) => b.count - a.count),
      notInBandzoogle: fans.filter((f) => !inBandzoogle(f)).length,
      ...(i.since ? { since: i.since, newSince: fans.filter((f) => f.createdAt && dateInBandZone(f.createdAt.toDate()) >= i.since!).length } : {}),
    };
  },
});

const miles = z.number().positive().max(3000);
export const fansNear = defineCommand({
  name: "fans.near", roles: [...COUNTS],
  description:
    "Fans who signed up from a city within `miles` (default 60, straight-line) of a place. Give one of: place (text like \"Boise, ID\"), venueId (a venue's town), or lat and lng. " +
    "Everyone gets the count; admins also get the fans (email, name, nearest city, distance). notLocated counts fans whose cities could not be placed on the map.",
  input: strict({ place: z.string().trim().min(1).optional(), venueId: z.string().min(1).optional(), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), miles: miles.default(60) })
    .refine((i) => [!!i.place, !!i.venueId, i.lat !== undefined || i.lng !== undefined].filter(Boolean).length === 1, "Give exactly one of place, venueId, or lat and lng")
    .refine((i) => (i.lat === undefined) === (i.lng === undefined), "Give both lat and lng"),
  async run(ctx, i) {
    const artistId = await fanArtistId(ctx);
    let center: { lat: number; lng: number }, label: string;
    if (i.lat !== undefined && i.lng !== undefined) { center = { lat: i.lat, lng: i.lng }; label = `${i.lat}, ${i.lng}`; }
    else {
      let text = i.place!;
      if (i.venueId) {
        const v = await db.get("venues", i.venueId);
        if (!v || v.deletedAt) throw new AppError("not_found", "Venue not found", 404);
        text = cityLabel({ city: v.address.city, state: v.address.state });
      }
      const hit = await geocodeText(text);
      if (!hit) throw new AppError("invalid_input", `Couldn't find "${text}" on the map. Try a city and state, like "Boise, ID".`, 400);
      center = hit; label = text;
    }
    const near: { f: Doc; city: CityLike; distance: number }[] = [];
    let notLocated = 0;
    for (const f of await loadFans(artistId)) {
      const cs = ((f.cities ?? []) as CityLike[]).filter((c) => c.lat !== undefined && c.lng !== undefined);
      if (!cs.length) { if ((f.cities ?? []).length) notLocated++; continue; }
      const best = cs.map((c) => ({ c, d: haversineMiles(center, { lat: c.lat!, lng: c.lng! }) })).sort((a, b) => a.d - b.d)[0];
      if (best.d <= i.miles) near.push({ f, city: best.c, distance: best.d });
    }
    near.sort((a, b) => a.distance - b.distance);
    return {
      place: label, miles: i.miles, count: near.length, notLocated,
      ...((await canSeeFans(ctx)) ? { fans: near.map(({ f, city, distance }) => ({ id: f.id, email: f.email, firstName: f.firstName ?? null, city: cityLabel(city), miles: Math.round(distance) })) } : {}),
    };
  },
});

export const fansNewSince = defineCommand({
  name: "fans.newSince", roles: [...COUNTS],
  description:
    "The after-show nudge, counts only: with showId, how many fans signed up at that show (added) and how many of those aren't in Bandzoogle yet (notInBandzoogle), plus label and date of the show. " +
    "Without showId, just the list-wide notInBandzoogle. Always returns total notInBandzoogle too (the Fans nav badge).",
  input: strict({ showId: z.string().min(1).optional() }),
  async run(ctx, i) {
    const artistId = await fanArtistId(ctx);
    const fans = await loadFans(artistId);
    const total = fans.filter((f) => !inBandzoogle(f)).length;
    if (!i.showId) return { notInBandzoogle: total };
    const show = await db.get("shows", i.showId);
    if (!show || show.deletedAt || show.artistId !== artistId) throw new AppError("not_found", "Show not found", 404);
    const here = fans.filter((f) => (f.showIds ?? []).includes(i.showId));
    return { showId: i.showId, label: showLabel(show), date: show.date, added: here.length, notInBandzoogle: here.filter((f) => !inBandzoogle(f)).length, totalNotInBandzoogle: total, };
  },
});

// ---------- Bandzoogle ----------

interface Group { group: string; fans: Doc[] }
/** Fans not yet in Bandzoogle, grouped by their most recent city ("City, ST", else "No city"); biggest groups first. */
async function unsynced(artistId: string): Promise<Group[]> {
  const by = new Map<string, Doc[]>();
  for (const f of await loadFans(artistId)) {
    if (inBandzoogle(f)) continue;
    const g = groupOf((f.cities ?? []) as CityLike[]);
    by.set(g, [...(by.get(g) ?? []), f]);
  }
  return [...by].map(([group, fans]) => ({ group, fans })).sort((a, b) => b.fans.length - a.fans.length || a.group.localeCompare(b.group));
}

export const fansForBandzoogle = defineCommand({
  name: "fans.forBandzoogle", roles: [...ADMIN_ONLY],
  description:
    "Fans not yet added to Bandzoogle (admins only), grouped by their most recent city named \"City, ST\" (no city -> \"No city\"). Each group: {group, count, ids, emails, csv} where csv is the addresses comma-separated, ready to paste. " +
    "Nothing is marked: after the admin has pasted a group, confirm and call fans.markSynced.",
  input: strict({}),
  async run(ctx) {
    const artistId = await requireFanAdmin(ctx);
    const groups = (await unsynced(artistId)).map(({ group, fans }) => {
      const emails = fans.map((f) => f.email as string).sort();
      return { group, count: fans.length, ids: fans.map((f) => f.id), emails, csv: emails.join(", ") };
    });
    return { total: groups.reduce((n, g) => n + g.count, 0), groups };
  },
});

export const fansMarkSynced = defineCommand({
  name: "fans.markSynced", roles: [...ADMIN_ONLY],
  description:
    "Stamp fans as added to Bandzoogle (admins only), so fans.forBandzoogle never offers them again. Give ids (fan ids), or group (a group name from fans.forBandzoogle, e.g. \"Boise, ID\"): exactly one. " +
    "Each fan is stamped with their own group name; fans already stamped are skipped. Only after the admin says they pasted the addresses.",
  input: strict({ ids: z.array(z.string().min(1)).min(1).max(1000).optional(), group: z.string().trim().min(1).optional() })
    .refine((i) => !!i.ids !== !!i.group, "Give exactly one of ids or group"),
  async run(ctx, i) {
    const artistId = await requireFanAdmin(ctx);
    const targets = i.group
      ? (await unsynced(artistId)).filter((g) => g.group.toLowerCase() === i.group!.toLowerCase()).flatMap((g) => g.fans.map((f) => f.id))
      : [...new Set(i.ids!)];
    const marked: Record<string, number> = {};
    let skipped = 0;
    // Chunked: one transaction per 200 fans stays well under Firestore's write limit (each fan also writes a history entry).
    for (let at = 0; at < targets.length; at += 200) {
      await run(ctx, async (w) => {
        for (const id of targets.slice(at, at + 200)) {
          const f = await requireFan(w, id, artistId);
          if (f.bandzoogle?.addedAt) { skipped++; continue; }
          const group = groupOf((f.cities ?? []) as CityLike[]);
          await w.update("fans", id, { bandzoogle: { addedAt: w.now, group } });
          marked[group] = (marked[group] ?? 0) + 1;
        }
      });
    }
    return { marked: Object.values(marked).reduce((n, x) => n + x, 0), skipped, groups: marked };
  },
});

export const fanCommands = [fansAdd, fansUpdate, fansRemove, fansList, fansCounts, fansNear, fansNewSince, fansForBandzoogle, fansMarkSynced];
