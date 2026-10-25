/**
 * The fan email list (stories 31, F3-F5). The public page talks to `listView` and `signup` (no login: the route files are thin);
 * the fans.* commands use the rest. Fan emails are private to the artist's admins: everything that leaves here for anyone else is a count.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { firestore } from "./admin";
import { db, run, type Doc, type Writer } from "./db";
import { AppError } from "./errors";
import { newRunId, type Ctx } from "./ctx";
import { geocodeCity } from "./geocode";
import { roleIn } from "@/schema/users";
import { pickShow, recentAndUpcoming, type PickableShow } from "@/lib/pickShow";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import { publicShowName, showCity, type ShowPlaceLike } from "@/lib/shows";
import { DEFAULT_LIST_WORDING, mergeCities, parseCity, sameCity, type CityLike } from "@/lib/fans";

// ---------- ids and access ----------

/** One doc per (artist, email): the id is a hash, so the same person is found again without a query. */
export const fanId = (artistId: string, email: string) =>
  createHash("sha256").update(`${artistId}:${email.trim().toLowerCase()}`).digest("hex").slice(0, 40);

/** Admins see fan emails. Members, and AI callers who are not admins of the artist, get counts only. */
export async function canSeeFans(ctx: Ctx): Promise<boolean> {
  if (ctx.role === "admin") return true;
  if (ctx.role !== "mcp" || !ctx.artistId) return false;
  const user = await db.get("users", ctx.uid);
  return !!user && !user.deletedAt && roleIn(user, ctx.artistId) === "admin";
}
export async function requireFanAdmin(ctx: Ctx): Promise<string> {
  if (!(await canSeeFans(ctx))) throw new AppError("forbidden", "Only this band's admins can see or change the fan list. Counts are open to everyone.", 403);
  return fanArtistId(ctx);
}
/** The artist a call is for: ctx.artistId, else the one artist there is. */
export async function fanArtistId(ctx: Ctx): Promise<string> {
  if (ctx.artistId) return ctx.artistId;
  const all = await db.list("artists");
  if (all.length === 1) return all[0].id;
  throw new AppError("artist_required", "Say which artist this is for", 400);
}

// ---------- shows ----------

/** Confirmed and played shows, of any kind (answer 4). Never hold, canceled or dropped. */
export const countable = (s: Doc) => !s.deletedAt && (s.status === "confirmed" || s.status === "played");

export async function artistShows(artistId: string): Promise<Doc[]> {
  return db.list("shows", (q) => q.where("artistId", "==", artistId));
}

/** What a fan sees of a show, and what fans.counts shows admins: the venue (or "House concert") and its town. Never an address, host or deal. */
export function showLabel(s: Doc): string {
  const name = publicShowName(s as unknown as ShowPlaceLike), city = showCity(s as unknown as ShowPlaceLike);
  return city && !name.includes(city) ? `${name} · ${city}` : name;
}

/** Venue time zones by venue id (hand-picked on the venue; missing = the band's zone). */
async function venueZones(shows: Doc[]): Promise<Map<string, string>> {
  const ids = [...new Set(shows.map((s) => s.venue?.id as string | undefined).filter((x): x is string => !!x))];
  const docs = await Promise.all(ids.map((v) => db.get("venues", v)));
  const out = new Map<string, string>();
  for (const v of docs) if (v && typeof v.timeZone === "string" && v.timeZone) out.set(v.id, v.timeZone);
  return out;
}

/** The town a show puts a fan in: the venue doc's city and state; a house show has only its place.city (no state). */
async function showPlace(s: Doc): Promise<CityLike | undefined> {
  if (s.venue?.id) {
    const v = await db.get("venues", s.venue.id);
    const city = (v?.address?.city as string | undefined) ?? (s.venue.city as string | undefined);
    return city ? { city, ...(v?.address?.state ? { state: v.address.state as string } : {}) } : undefined;
  }
  return s.place?.city ? { city: s.place.city as string } : undefined;
}

// ---------- public list page ----------

type ShowDoc = Doc & PickableShow & { id: string };

export interface ListView {
  artistName: string;
  instagram: string | null;
  wording: string;
  current: { showId: string; label: string; date: string; mode: "during" | "morning-after" } | null;
  choices: { showId: string; label: string; date: string }[];
}

/** Artist by URL slug, with the fan list switched on. Same 404 for "no such band" and "list is off", so nothing is revealed. */
export async function listArtist(slug: string): Promise<Doc> {
  const [a] = await db.list("artists", (q) => q.where("slug", "==", slug).limit(1));
  const features = a?.features as { fans?: boolean } | undefined;
  if (!a || features?.fans !== true) throw new AppError("not_found", "Not found", 404);
  return a;
}
const wordingOf = (a: Doc) => (typeof a.listWording === "string" && a.listWording.trim() ? a.listWording.trim() : DEFAULT_LIST_WORDING);

export async function listView(slug: string, now: Date = new Date()): Promise<ListView> {
  const artist = await listArtist(slug);
  const shows = (await artistShows(artist.id)).filter(countable) as ShowDoc[];
  const zones = await venueZones(shows);
  const zoneOf = (s: ShowDoc) => zones.get(s.venue?.id) ?? BAND_TIME_ZONE;
  const hit = pickShow(shows, now, { zoneOf });
  const brief = (s: ShowDoc) => ({ showId: s.id, label: showLabel(s), date: s.date as string });
  return {
    artistName: artist.name,
    instagram: (artist.links?.instagram as string | undefined) || null,
    wording: wordingOf(artist),
    current: hit ? { ...brief(hit.show), mode: hit.mode } : null,
    choices: recentAndUpcoming(shows, now, 8, { zoneOf }).map(brief),
  };
}

// ---------- writing a fan ----------

/** Public writes have no person behind them: a system actor, not a login. History carries the artistId, so only that artist's admins read it. */
const publicCtx = (artistId: string, now?: Date): Ctx => ({ uid: "public:fans", role: "member", artistId, via: "app", runId: newRunId(), ...(now ? { now } : {}) });
export const fanCtx = publicCtx;

export interface FanWrite {
  artistId: string;
  email: string;
  firstName?: string;
  cities: CityLike[];
  showIds: string[];
  source: "list" | "paper";
  /** Set only on a first join through the public page. */
  consent?: { text: string; at: string; page: string };
}

/** Coordinates for the incoming cities: copied from the fan's own matching city, else geocoded. A failed lookup just leaves them off. */
async function located(existing: CityLike[], incoming: CityLike[]): Promise<CityLike[]> {
  const out: CityLike[] = [];
  for (const c of incoming) {
    if (c.lat !== undefined && c.lng !== undefined) { out.push(c); continue; }
    const had = existing.find((e) => sameCity(e, c) && e.lat !== undefined && e.lng !== undefined);
    if (had) { out.push({ ...c, lat: had.lat, lng: had.lng }); continue; }
    const hit = await geocodeCity(c);
    out.push(hit ? { ...c, ...hit } : c);
  }
  return out;
}

/** Create the fan, or merge into the one with this email: cities and shows are unioned, consent is only ever set once. */
export async function upsertFan(ctx: Ctx, a: FanWrite): Promise<{ id: string; created: boolean }> {
  const email = a.email.trim().toLowerCase();
  const id = fanId(a.artistId, email);
  const before = await db.get("fans", id);
  const cities = await located((before?.cities ?? []) as CityLike[], a.cities);
  return run(ctx, async (w) => {
    const cur = await w.get("fans", id);
    if (!cur) {
      await w.create("fans", {
        artistId: a.artistId, email, ...(a.firstName ? { firstName: a.firstName } : {}), cities: mergeCities([], cities), showIds: [...new Set(a.showIds)],
        source: a.source, ...(a.consent ? { consent: a.consent } : {}), lastSeenAt: w.now,
      }, { id });
      return { id, created: true };
    }
    if (cur.artistId !== a.artistId) throw new AppError("not_found", "Fan not found", 404);
    if (cur.deletedAt) await w.restore("fans", id);
    await w.update("fans", id, {
      cities: mergeCities((cur.cities ?? []) as CityLike[], cities),
      showIds: [...new Set([...(cur.showIds ?? []), ...a.showIds])],
      ...(cur.firstName || !a.firstName ? {} : { firstName: a.firstName }),
      ...(cur.consent || !a.consent ? {} : { consent: a.consent }),
      lastSeenAt: w.now,
    });
    return { id, created: false };
  });
}

/** A show the artist played or will play, or a 400. Used by signup and fans.add. */
export async function countableShow(artistId: string, showId: string): Promise<Doc> {
  const s = await db.get("shows", showId);
  if (!s || s.artistId !== artistId || !countable(s)) throw new AppError("invalid_input", "That show isn't one fans can sign up at", 400);
  return s;
}

/** Cities for a signup: the show's town, else the typed one. */
export async function citiesFor(show: Doc | undefined, typed?: { city?: string; state?: string }): Promise<CityLike[]> {
  if (show) { const p = await showPlace(show); return p ? [p] : []; }
  const t = typed?.city?.trim();
  if (!t) return [];
  const p = parseCity(t);
  const state = typed?.state?.trim() || p.state;
  return [{ city: p.city, ...(state ? { state: state.toUpperCase() } : {}) }];
}

export const SignupBody = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.string().email("Enter a valid email address")),
  firstName: z.string().trim().max(60).optional(),
  showId: z.string().trim().min(1).max(100).optional(),
  city: z.string().trim().max(80).optional(),
  page: z.string().trim().min(1).max(300),
});
export type SignupBody = z.infer<typeof SignupBody>;

/** The public signup. Always {ok: true} for a valid request, so the answer never says whether the address was already on the list. */
export async function signup(slug: string, body: SignupBody, now: Date = new Date()): Promise<{ ok: true }> {
  const artist = await listArtist(slug);
  const show = body.showId ? await countableShow(artist.id, body.showId) : undefined;
  const cities = await citiesFor(show, { city: body.city });
  await upsertFan(publicCtx(artist.id, now), {
    artistId: artist.id, email: body.email, ...(body.firstName ? { firstName: body.firstName } : {}),
    cities, showIds: show ? [show.id] : [], source: "list",
    consent: { text: wordingOf(artist), at: now.toISOString(), page: body.page },
  });
  return { ok: true };
}

// ---------- reading and deleting (commands) ----------

export async function loadFans(artistId: string): Promise<Doc[]> {
  return db.list("fans", (q) => q.where("artistId", "==", artistId));
}

export async function requireFan(w: Writer, id: string, artistId: string): Promise<Doc> {
  const f = await w.get("fans", id);
  if (!f || f.deletedAt || f.artistId !== artistId) throw new AppError("not_found", "Fan not found", 404);
  return f;
}

/** Hard delete (answer 12): the fan and their history are gone for good, so the address cannot be read back from a change log. */
export async function deleteFan(artistId: string, id: string): Promise<void> {
  const f = await db.get("fans", id);
  if (!f || f.artistId !== artistId) throw new AppError("not_found", "Fan not found", 404);
  await firestore().recursiveDelete(firestore().doc(`fans/${id}`));
}
