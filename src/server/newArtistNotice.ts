/**
 * "A new artist joined Roadie": an email to Roadie's platform admins (platform/admins) each time an artist is created, by public
 * sign-up (src/server/signUp.ts) or by artists.create. Roadie has no mailbox of its own, so it goes out from the first platform
 * admin whose own Google grant covers Gmail (googleGrants), to every platform admin; if that grant fails (expired, removed),
 * the next admin's is tried. No env vars: who gets it and who sends it are both platform/admins.
 *
 * Called after the artist's write unit has committed, and never throws: a failure (no grant, Gmail down, a slow call) is logged
 * as `artists.newArtistNotice` and the new artist is unaffected.
 */
import { firestore } from "./admin";
import { db } from "./db";
import { systemCtx } from "./ctx";
import { gmailClient } from "./integrations";
import { getGrant } from "./google/grants";
import { PLATFORM_ADMINS_DOC } from "./platform";
import { readLimits, USAGE, platformUsageId } from "./usage";
import { artistsFor } from "./session";
import { appUrl } from "@/lib/app-url";
import { DEFAULT_TIME_ZONE } from "@/lib/timezone";

/** How long creation waits for the notice before giving up on it (it is awaited so Cloud Run doesn't freeze it mid-send). */
const TIMEOUT_MS = 10_000;

export interface NewArtistInfo { artistId: string; creatorUid: string; via: "signUp" | "artists.create"; now?: Date }

export async function noticeNewArtist(info: NewArtistInfo): Promise<{ sent: boolean; from?: string; reason?: string }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const out = await Promise.race([
      send(info),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS); }),
    ]);
    console.info(JSON.stringify({ event: "artists.newArtistNotice", artistId: info.artistId, ...out }));
    return out;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.warn(JSON.stringify({ event: "artists.newArtistNotice", artistId: info.artistId, sent: false, reason }));
    return { sent: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

async function send({ artistId, creatorUid, via, now = new Date() }: NewArtistInfo): Promise<{ sent: boolean; from?: string; reason?: string }> {
  const sys = systemCtx("new artist notice");
  const fs = firestore();
  const adminUids = ((await fs.doc(PLATFORM_ADMINS_DOC).get()).data()?.uids as string[] | undefined) ?? [];
  if (!adminUids.length) return { sent: false, reason: "no platform admins" };
  const admins = (await Promise.all(adminUids.map((uid) => db.get(sys, "users", uid))))
    .flatMap((u, i) => (u && !u.deletedAt && typeof u.email === "string" && u.email ? [{ uid: adminUids[i], email: u.email, user: u }] : []));
  if (!admins.length) return { sent: false, reason: "no platform admin has an email" };

  const [artist, creator, limits, day] = await Promise.all([
    db.get(sys, "artists", artistId),
    db.get(sys, "users", creatorUid),
    readLimits(),
    fs.collection(USAGE).doc(platformUsageId(now.toISOString().slice(0, 10))).get(),
  ]);
  const name = String(artist?.name ?? artistId);
  const creatorName = String(creator?.name ?? "") || "(no name)";
  const creatorEmail = String(creator?.email ?? "") || "(no email)";
  const zone = (typeof artist?.timeZone === "string" && artist.timeZone) || DEFAULT_TIME_ZONE;
  const today = Number(day.data()?.newArtists ?? 0);

  const subject = `New artist on Roadie: ${name}`;
  let lastReason = "no platform admin has connected Gmail";
  for (const a of admins) {
    const grant = await getGrant(a.uid);
    if (!grant?.features.includes("gmail")) continue;
    // The platform page lives inside an artist: the sender's first one (every platform admin can open it from any of theirs).
    const home = (await artistsFor(a.user))[0];
    const link = home ? `${appUrl()}/artists/${home.slug}/admin/platform` : `${appUrl()}/artists`;
    const body = [
      `${creatorName} (${creatorEmail}) just started ${name} on Roadie${via === "signUp" ? " through sign-up" : " with New artist"}.`,
      "",
      `Artist: ${name}${artist?.slug ? ` (${appUrl()}/artists/${artist.slug})` : ""}`,
      `Created by: ${creatorName} <${creatorEmail}>`,
      `Time zone: ${zone}`,
      `New artists today (UTC): ${today} of ${limits.newArtistsPerDay}. Platform admins' own aren't counted.`,
      "",
      `See every artist, and suspend one, on the Platform page: ${link}`,
    ].join("\n");
    try {
      await gmailClient().send({ account: grant.googleEmail, to: admins.map((x) => x.email), subject, body });
      return { sent: true, from: grant.googleEmail };
    } catch (e) {
      lastReason = `${grant.googleEmail}: ${e instanceof Error ? e.message : String(e)}`;
      console.warn(JSON.stringify({ event: "artists.newArtistNotice", artistId, sent: false, from: grant.googleEmail, reason: lastReason }));
    }
  }
  return { sent: false, reason: lastReason };
}
