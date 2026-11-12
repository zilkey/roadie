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
import { geocodeCity, zipPlace } from "./geocode";
import { roleIn } from "@/schema/users";
import { inFanWindow, showTimeAt, signupShow, type PickableShow } from "@/lib/pickShow";
import { ARTIST_LINKS, normalizeInstagramUrl, paymentAppOf, type FanLink, type MerchItem } from "@/schema/artists";
import type { ShowFanPage } from "@/schema/shows";
import { withScheme } from "@/lib/links";
import { dateInBandZone } from "@/lib/timezone";
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

/** One show's line on the fan page: what fans see and the Venmo note, the amount each, and the button's kind. */
export interface FanShowLine { id: string; name: string; amountCents: number; button: "ticket" | "donation" }

export interface ListView {
  /** The artist's public name (publicName, else name). */
  artistName: string;
  /** The logo shown instead of the name (a data URL), or null. */
  logo: string | null;
  wording: string;
  /** The show a signup right now belongs to (signupShow), or null. */
  current: { showId: string; label: string; date: string } | null;
  /** The merch price list and the Venmo handle to pay; null when merch is off or there is no Venmo link. */
  merch: { venmo: string; items: { id: string; name: string; priceCents: number }[] } | null;
  /** Shows with their fan page line on and in its window (see showsOnPage), each a Venmo button; null when there are none or no Venmo link. */
  shows: { venmo: string; items: FanShowLine[] } | null;
  /** The fan page's own links, in order. */
  links: { id: string; name: string; url: string }[];
  /** The artist's public links (Instagram, Spotify, website...), in ARTIST_LINKS order, for the footer. */
  socials: { key: string; label: string; url: string }[];
  style: { theme: "auto" | "light" | "dark"; accent: string | null };
}

/** Artist by URL slug, with the fan list switched on. Same 404 for "no such band" and "list is off", so nothing is revealed. */
export async function listArtist(slug: string): Promise<Doc> {
  const [a] = await db.list("artists", (q) => q.where("slug", "==", slug).limit(1));
  const features = a?.features as { fans?: boolean } | undefined;
  if (!a || features?.fans !== true) throw new AppError("not_found", "Not found", 404);
  return a;
}
const wordingOf = (a: Doc) => (typeof a.listWording === "string" && a.listWording.trim() ? a.listWording.trim() : DEFAULT_LIST_WORDING);
/** The name fans see: publicName, else the artist's name. */
export const publicNameOf = (a: Doc): string => (typeof a.publicName === "string" && a.publicName.trim() ? a.publicName.trim() : a.name);

/** The show a signup at `now` belongs to (signupShow over the artist's confirmed and played shows, each in its venue's zone). */
async function currentShow(artistId: string, now: Date): Promise<ShowDoc | null> {
  const shows = (await artistShows(artistId)).filter(countable) as ShowDoc[];
  const zones = await venueZones(shows);
  return signupShow(shows, now, { zoneOf: (s) => zones.get(s.venue?.id) ?? BAND_TIME_ZONE });
}

/**
 * The shows whose fan page line shows at `now`: on, with an amount, not canceled, dropped or archived, and `now` from 1 hour before
 * the show time to 3 hours after (in the venue's zone). `previewId` (the Preview link on a show) adds that show's line whatever the
 * time or checkbox, as long as it is this artist's and has an amount.
 */
async function showsOnPage(artistId: string, now: Date, previewId?: string): Promise<FanShowLine[]> {
  const live = (s: Doc) => !s.deletedAt && s.status !== "canceled" && s.status !== "dropped" && !!(s.fanPage as ShowFanPage | undefined)?.amountCents;
  const all = (await artistShows(artistId)).filter(live) as ShowDoc[];
  const zones = await venueZones(all);
  const picked = all
    .filter((s) => s.id === previewId || ((s.fanPage as ShowFanPage).on && inFanWindow(showTimeAt(s, zones.get(s.venue?.id) ?? BAND_TIME_ZONE), now)))
    .sort((a, b) => a.date.localeCompare(b.date) || showTimeAt(a) - showTimeAt(b));
  return picked.map((s) => {
    const f = s.fanPage as ShowFanPage;
    return { id: s.id, name: f.name?.trim() || publicShowName(s as unknown as ShowPlaceLike), amountCents: f.amountCents!, button: f.button ?? "ticket" };
  });
}

export async function listView(slug: string, now: Date = new Date(), previewShowId?: string): Promise<ListView> {
  const artist = await listArtist(slug);
  const hit = await currentShow(artist.id, now);
  const pay = typeof artist.paymentUrl === "string" ? paymentAppOf(artist.paymentUrl) : null;
  const merchOn = (artist.features as { merch?: boolean } | undefined)?.merch === true && pay?.app === "venmo";
  const style = (artist.fanPageStyle ?? {}) as { theme?: "auto" | "light" | "dark"; accent?: string };
  const items = ((artist.merchItems ?? []) as MerchItem[]).map(({ id, name, priceCents }) => ({ id, name, priceCents }));
  const links = ((artist.fanLinks ?? []) as FanLink[]).map(({ id, name, url }) => ({ id, name, url }));
  const socials = ARTIST_LINKS.flatMap(([key, label]) => {
    const v = (artist.links as Record<string, string | undefined> | undefined)?.[key]?.trim();
    if (!v) return [];
    const ig = key === "instagram" ? normalizeInstagramUrl(v) : null;
    return [{ key, label, url: ig && "url" in ig ? ig.url : withScheme(v) }];
  });
  return {
    artistName: publicNameOf(artist),
    logo: (artist.logo?.dataUrl as string | undefined) ?? null,
    wording: wordingOf(artist),
    current: hit ? { showId: hit.id, label: showLabel(hit), date: hit.date as string } : null,
    merch: merchOn && items.length ? { venmo: pay!.handle, items } : null,
    shows: pay?.app === "venmo" ? await showsOnPage(artist.id, now, previewShowId).then((items) => (items.length ? { venmo: pay.handle, items } : null)) : null,
    links,
    socials,
    style: { theme: style.theme ?? "auto", accent: style.accent ?? null },
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
  /** A US zip code (public page): stored as the fan's latest zip. */
  zip?: string;
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
        artistId: a.artistId, email, ...(a.firstName ? { firstName: a.firstName } : {}), ...(a.zip ? { zip: a.zip } : {}), cities: mergeCities([], cities), showIds: [...new Set(a.showIds)],
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
      ...(a.zip ? { zip: a.zip } : {}),
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
  /** Stored as the fan's firstName (the field's old key). */
  name: z.string().trim().max(60).optional(),
  zip: z.string().trim().regex(/^\d{5}$/, "Use a 5-digit zip code").optional(),
  page: z.string().trim().min(1).max(300),
});
export type SignupBody = z.infer<typeof SignupBody>;

/**
 * The public signup. The show is never sent by the page: it is the one whose time is 1 hour ahead to 3 hours behind `now`
 * (signupShow). The fan's towns: the show's, plus the one their zip is in. Always {ok: true} for a valid request, so the answer
 * never says whether the address was already on the list.
 */
export async function signup(slug: string, body: SignupBody, now: Date = new Date()): Promise<{ ok: true }> {
  const artist = await listArtist(slug);
  const show = (await currentShow(artist.id, now)) ?? undefined;
  const cities = await citiesFor(show);
  if (body.zip) {
    const z = await zipPlace(body.zip);
    if (z && !cities.some((c) => sameCity(c, z))) cities.push(z);
  }
  await upsertFan(publicCtx(artist.id, now), {
    artistId: artist.id, email: body.email, ...(body.name ? { firstName: body.name } : {}), ...(body.zip ? { zip: body.zip } : {}),
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
