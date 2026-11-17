/**
 * Admin › Platform's "New artists" list (tenancy phase 9 follow-up): every artist on Roadie, newest first, with who started it,
 * today's usage against the daily limits, and its platformArtists flags; and Suspend / Unsuspend. Platform admins only
 * (platform/admins): the collections read here (usage, platformArtists, platform/limits) are server-only, so the browser
 * gets them through these commands. Never offered to Roadie (policy.ts EXCLUDED "platform.") or MCP (no "mcp" role).
 */
import { z } from "zod";
import { Timestamp, type DocumentData, type DocumentReference, type DocumentSnapshot } from "firebase-admin/firestore";
import { defineCommand } from "./types";
import { firestore } from "../admin";
import { AppError } from "../errors";
import { PLATFORM_ARTISTS, membersOf, requirePlatformAdmin, setArtistFlags } from "../platform";
import { METERS, USAGE, platformUsageId, readLimits, usageId, type Meter } from "../usage";
import { syncClaims } from "../session";
import { DEFAULT_TIME_ZONE, dateInZone } from "@/lib/timezone";

const APP = ["admin", "member"] as const;
const iso = (t: unknown) => (t instanceof Timestamp ? t.toDate().toISOString() : null);

export interface PlatformArtistRow {
  id: string; name: string; slug: string; timeZone: string; createdAt: string | null;
  creator: { uid: string; name: string; email: string } | null;
  /** The artist's own date (its zone) the usage is for. */
  usageDate: string; usage: Record<Meter, number>;
  exempt: boolean; suspendedAt: string | null;
}

export const platformArtists = defineCommand({
  name: "platform.artists", roles: [...APP],
  description: "Roadie's platform admins only: every artist on Roadie, newest first, with its creator, today's usage against the daily limits, and whether it is exempt or suspended.",
  input: z.strictObject({}),
  async run(ctx) {
    await requirePlatformAdmin(ctx);
    const fs = firestore();
    const now = ctx.now ?? new Date();
    const [snap, limits, day] = await Promise.all([
      fs.collection("artists").get(),
      readLimits(),
      fs.collection(USAGE).doc(platformUsageId(now.toISOString().slice(0, 10))).get(),
    ]);
    const live = snap.docs.filter((d) => !d.data().deletedAt);
    const zoneOf = (d: DocumentData) => (typeof d.timeZone === "string" && d.timeZone) || DEFAULT_TIME_ZONE;
    const dates = live.map((d) => dateInZone(zoneOf(d.data()), now));
    const creatorUids = [...new Set(live.map((d) => d.data().createdBy).filter((u): u is string => typeof u === "string" && !!u))];
    const all = async (refs: DocumentReference[]): Promise<DocumentSnapshot[]> => (refs.length ? fs.getAll(...refs) : []);
    const [usage, flags, creators] = await Promise.all([
      all(live.map((d, i) => fs.collection(USAGE).doc(usageId(d.id, dates[i])))),
      all(live.map((d) => fs.collection(PLATFORM_ARTISTS).doc(d.id))),
      all(creatorUids.map((u) => fs.collection("users").doc(u))),
    ]);
    const byUid = new Map(creators.map((c) => [c.id, c.data()]));
    const artists: PlatformArtistRow[] = live.map((d, i) => {
      const a = d.data();
      const u = usage[i].data() ?? {};
      const f = flags[i].data() ?? {};
      const c = typeof a.createdBy === "string" ? byUid.get(a.createdBy) : undefined;
      return {
        id: d.id, name: String(a.name ?? d.id), slug: String(a.slug ?? ""), timeZone: zoneOf(a), createdAt: iso(a.createdAt),
        creator: typeof a.createdBy === "string" && a.createdBy ? { uid: a.createdBy, name: String(c?.name ?? ""), email: String(c?.email ?? "") } : null,
        usageDate: dates[i], usage: Object.fromEntries(METERS.map((m) => [m, Number(u[m] ?? 0)])) as Record<Meter, number>,
        exempt: f.exempt === true, suspendedAt: iso(f.suspendedAt),
      };
    }).sort((x, y) => (y.createdAt ?? "").localeCompare(x.createdAt ?? "") || x.name.localeCompare(y.name));
    return {
      limits: Object.fromEntries(METERS.map((m) => [m, limits[m]])) as Record<Meter, number>,
      newArtistsToday: Number(day.data()?.newArtists ?? 0), newArtistsPerDay: limits.newArtistsPerDay,
      artists,
    };
  },
});

export const platformSuspend = defineCommand({
  name: "platform.suspend", roles: [...APP],
  description: "Roadie's platform admins only: suspend an artist (its calls, MCP and Shortcut are refused, its fan page is gone, its members lose it) or, with suspended false, let it back in.",
  input: z.strictObject({ artistId: z.string().min(1), suspended: z.boolean() }),
  async run(ctx, { artistId, suspended }) {
    await requirePlatformAdmin(ctx);
    const a = await firestore().collection("artists").doc(artistId).get();
    if (!a.exists || a.data()?.deletedAt) throw new AppError("not_found", "No such artist", 404);
    if (suspended && artistId === ctx.artistId) throw new AppError("invalid_input", "You can't suspend the artist you're working in. Switch to another artist first.", 400);
    await setArtistFlags(artistId, { suspended }, ctx.uid);
    // Every member's claims are set again, so the browser stops (or starts again) reading the artist (as scripts/platform-config.ts does).
    const people = await membersOf(artistId);
    for (const p of people) await syncClaims(p.uid);
    return { artistId, suspended };
  },
});

export const platformCommands = [platformArtists, platformSuspend];
