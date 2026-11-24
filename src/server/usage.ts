/**
 * Daily limits per artist on the paid APIs Roadie pays for (tenancy plan phase 9, Q8), and the caps on new artists.
 *
 * - `usage/{artistId}_{yyyy-mm-dd}` (date in the artist's own zone): counters `roadieMessages`, `webLookups`, `transcriptions`,
 *   `imageReads`, `maps`, `publicMaps`. `spend(ctx, meter)` adds to one, refusing with 429 `limit_reached` once the day's limit is used.
 * - `usage/platform_{yyyy-mm-dd}` (UTC date): `newArtists` and `newArtistsBy.{uid}`, for `checkNewArtist`.
 * - `usage/signUp_{yyyy-mm-ddThh}` (UTC hour): `byUid.{uid}` and `byIp.{hash}`, for `checkSignUpTry`. `expiresAt` (a day
 *   on) lets the TTL policy on usage.expiresAt delete them.
 * - `platform/limits`: the limits, changed by `scripts/platform-config.ts` (no deploy). A field it doesn't set uses DEFAULT_LIMITS.
 *
 * Charged at the command or route layer, where the ctx is, and only when the paid call is really made (a cache hit costs
 * nothing): the map helpers take a `charge` they call just before going out. Exempt artists (platformArtists/{id}.exempt) and
 * SystemCtx jobs are never limited; system calls are logged. All of it is server-only (no client rule; SERVER_KEPT in backups).
 */
import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "./admin";
import { AppError } from "./errors";
import { db } from "./db";
import { isSystem, type ArtistCtx, type PersonCtx, type SystemCtx } from "./ctx";
import { zoneOf } from "./zone";
import { artistFlags, isPlatformAdminUid } from "./platform";
import { signUpOpen, INVITE_ONLY } from "./signUpFlag";
import { dateInZone } from "@/lib/timezone";

export type Meter = "roadieMessages" | "webLookups" | "transcriptions" | "imageReads" | "maps" | "publicMaps";
export const METERS: Meter[] = ["roadieMessages", "webLookups", "transcriptions", "imageReads", "maps", "publicMaps"];

export interface Limits extends Record<Meter, number> {
  /** New artists per day across Roadie (UTC day). */
  newArtistsPerDay: number;
  /** New artists one person may start per day (UTC day). */
  newArtistsPerPerson: number;
  /** Tries at POST /api/sign-up per Google account per hour, failed ones included (checkSignUpTry). */
  signUpTriesPerPerson: number;
  /** Tries at POST /api/sign-up per IP address per hour; looser, since a household or office shares one. */
  signUpTriesPerIp: number;
}
/** Q8's defaults. */
export const DEFAULT_LIMITS: Limits = {
  roadieMessages: 300, webLookups: 100, transcriptions: 30, imageReads: 50, maps: 1000, publicMaps: 200,
  newArtistsPerDay: 20, newArtistsPerPerson: 3,
  signUpTriesPerPerson: 10, signUpTriesPerIp: 30,
};
export const LIMITS_DOC = "platform/limits";
export const USAGE = "usage";

/** What a refusal calls the thing used up: "<artist> has used today's <thing>." */
const THING: Record<Meter, string> = {
  roadieMessages: "Roadie messages", webLookups: "web lookups", transcriptions: "voice transcriptions", imageReads: "image reads",
  maps: "map lookups", publicMaps: "map lookups for its fan sign-up page",
};

export async function readLimits(): Promise<Limits> {
  const d = (await firestore().doc(LIMITS_DOC).get()).data() ?? {};
  const out = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(out) as (keyof Limits)[]) if (typeof d[k] === "number" && Number.isFinite(d[k]) && d[k] >= 0) out[k] = d[k];
  return out;
}

export const usageId = (artistId: string, date: string) => `${artistId}_${date}`;

/** The instant the artist's day `date` ends (local midnight), as an ISO string: when the counters start again. */
export function resetAt(zone: string, now: Date): string {
  // Walk forward to the first minute whose local date differs (at most a day and a bit; coarse then fine).
  const today = dateInZone(zone, now);
  let t = now.getTime();
  while (dateInZone(zone, new Date(t + 3600_000)) === today) t += 3600_000;
  while (dateInZone(zone, new Date(t)) === today) t += 60_000;
  return new Date(Math.floor(t / 60_000) * 60_000).toISOString();
}

/**
 * Charge `n` of `meter` to the ctx's artist for today. Throws 429 `limit_reached` (nothing is added) when that would pass the
 * limit; the error's data carries {meter, limit, used, resetsAt}. Exempt artists only count; SystemCtx calls are only logged.
 */
export async function spend(ctx: ArtistCtx | SystemCtx, meter: Meter, n = 1): Promise<void> {
  if (isSystem(ctx)) {
    console.info(JSON.stringify({ event: "usage.system", meter, n, reason: ctx.reason }));
    return;
  }
  const artistId = ctx.artistId;
  const now = ctx.now ?? new Date();
  const [zone, flags, limits] = await Promise.all([zoneOf(ctx), artistFlags(artistId), readLimits()]);
  const date = dateInZone(zone, now);
  const ref = firestore().collection(USAGE).doc(usageId(artistId, date));
  const limit = limits[meter];
  await firestore().runTransaction(async (tx) => {
    const used = Number((await tx.get(ref)).get(meter) ?? 0);
    if (!flags.exempt && used + n > limit) {
      const artist = await db.get(ctx, "artists", artistId);
      const name = (typeof artist?.name === "string" && artist.name) || "This artist";
      throw new AppError("limit_reached", `${name} has used today's ${THING[meter]}. It resets at midnight.`, 429, undefined, { meter, limit, used, resetsAt: resetAt(zone, now) });
    }
    tx.set(ref, { artistId, date, [meter]: FieldValue.increment(n), updatedAt: Timestamp.fromDate(now) }, { merge: true });
  });
}

/** Like spend, but answers false instead of throwing when the limit is reached (the public fan page: the fan still signs up). */
export async function trySpend(ctx: ArtistCtx | SystemCtx, meter: Meter, n = 1): Promise<boolean> {
  try { await spend(ctx, meter, n); return true; } catch (e) {
    if (e instanceof AppError && e.code === "limit_reached") return false;
    throw e;
  }
}

/**
 * What the map helpers call just before a paid lookup (never on a cache hit). true: go ahead; false: skip the lookup (the
 * helper answers as if nothing was found); throwing: refuse the whole call.
 */
export type Charge = () => Promise<boolean>;
/** A charge for a command: past the limit the command is refused (429). */
export const chargeTo = (ctx: ArtistCtx | SystemCtx, meter: Meter): Charge => async () => { await spend(ctx, meter); return true; };
/** A charge that degrades instead: past the limit the lookup is skipped. */
export const softChargeTo = (ctx: ArtistCtx | SystemCtx, meter: Meter): Charge => () => trySpend(ctx, meter);
/** Rethrow a limit refusal from inside a helper that otherwise swallows errors. */
export const isLimit = (e: unknown): e is AppError => e instanceof AppError && e.code === "limit_reached";

// ---------- new artists ----------

export const NEW_ARTIST_CAP = "Roadie isn't taking new artists right now. Try again tomorrow.";
export const platformUsageId = (utcDate: string) => `platform_${utcDate}`;

/**
 * Before a new artist is made (sign-up and artists.create, so neither gets around the other): sign-up must be open, and the day
 * (UTC) must be under both caps, Roadie-wide and per person. Platform admins pass. A passing check takes its place in the day's
 * count at once (in a transaction), so two at the same moment can't both slip past the last place.
 */
export async function checkNewArtist(ctx: PersonCtx | ArtistCtx): Promise<void> {
  if (await isPlatformAdminUid(ctx.uid)) return;
  if (!(await signUpOpen())) throw new AppError("invite_only", INVITE_ONLY, 403);
  const limits = await readLimits();
  const now = ctx.now ?? new Date();
  const date = now.toISOString().slice(0, 10);
  const ref = firestore().collection(USAGE).doc(platformUsageId(date));
  await firestore().runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() ?? {};
    const all = Number(d.newArtists ?? 0);
    const mine = Number((d.newArtistsBy as Record<string, number> | undefined)?.[ctx.uid] ?? 0);
    if (all + 1 > limits.newArtistsPerDay || mine + 1 > limits.newArtistsPerPerson) {
      console.warn(JSON.stringify({ event: "artists.newArtistCap", uid: ctx.uid, all, mine }));
      throw new AppError("new_artist_limit", NEW_ARTIST_CAP, 429);
    }
    tx.set(ref, { date, newArtists: FieldValue.increment(1), newArtistsBy: { [ctx.uid]: FieldValue.increment(1) }, updatedAt: Timestamp.fromDate(now) }, { merge: true });
  });
}

// ---------- sign-up tries ----------

export const SIGN_UP_THROTTLED = "Too many tries at starting a band. Wait an hour and try again.";
export const signUpTriesId = (now: Date) => `signUp_${now.toISOString().slice(0, 13)}`;

/**
 * The caller's IP from X-Forwarded-For, or null when there is none (local dev, tests). Google's load balancer appends
 * "<client>, <load balancer>" to whatever the client sent, so the client is the second from the right; anything further
 * left came from the client and can be made up. With one entry, that one.
 */
export function clientIp(xff: string | null): string | null {
  const parts = (xff ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : parts[parts.length - 2];
}

/** The IP as stored: a short hash, never the address itself. */
export const ipKey = (ip: string) => createHash("sha256").update(ip).digest("hex").slice(0, 16);

/**
 * Count one try at POST /api/sign-up against `who` (an IP before the token is checked, the uid after) for this UTC hour,
 * and refuse with 429 `sign_up_throttled` once it passes the limit. Every try counts, failed ones too: that's the point.
 */
export async function checkSignUpTry(who: { ip: string } | { uid: string }, now = new Date()): Promise<void> {
  if ("uid" in who && (await isPlatformAdminUid(who.uid))) return;
  const limits = await readLimits();
  const [field, key, limit] = "ip" in who ? ["byIp", ipKey(who.ip), limits.signUpTriesPerIp] : ["byUid", who.uid, limits.signUpTriesPerPerson];
  const ref = firestore().collection(USAGE).doc(signUpTriesId(now));
  const used = await firestore().runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() ?? {};
    const n = Number((d[field] as Record<string, number> | undefined)?.[key] ?? 0);
    tx.set(ref, { [field]: { [key]: FieldValue.increment(1) }, updatedAt: Timestamp.fromDate(now), expiresAt: Timestamp.fromMillis(now.getTime() + 86_400_000) }, { merge: true });
    return n + 1;
  });
  if (used > limit) {
    console.warn(JSON.stringify({ event: "artists.signUpThrottled", [field]: key, used, limit }));
    throw new AppError("sign_up_throttled", SIGN_UP_THROTTLED, 429);
  }
}
