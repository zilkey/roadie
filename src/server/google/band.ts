/**
 * The band's Google account: the admin whose grant Drive lookups use, kept on the artist as `google: {uid, email}`. The
 * first admin to connect Calendar or Drive becomes it; another admin can take over on Settings > Google. Gmail and
 * Calendar never use it: mail goes out from each admin's own account, and calendar events go on the band calendar as the
 * admin who sends them (src/server/calendarSync.ts).
 */
import { firestore } from "../admin";
import { IntegrationError } from "../integrations/http";
import { accessTokenFor } from "./grants";
import type { GoogleFeature } from "./oauth";

export interface BandGoogle { uid: string; email: string }

/** The artist's band account. Without an id (scripts, tests, one band per project) the first live artist's. */
export async function bandGoogle(artistId?: string): Promise<BandGoogle | null> {
  if (artistId) return ((await firestore().doc(`artists/${artistId}`).get()).data()?.google as BandGoogle | undefined) ?? null;
  const snap = await firestore().collection("artists").get();
  const live = snap.docs.map((d) => d.data()).find((a) => !a.deletedAt);
  return (live?.google as BandGoogle | undefined) ?? null;
}

export async function bandToken(artistId: string | undefined, feature: GoogleFeature, force?: boolean): Promise<string> {
  const g = await bandGoogle(artistId);
  if (!g) throw new IntegrationError(feature, 401, "The band has no Google account for Drive yet. An admin connects one on Settings > Google.");
  return accessTokenFor(g.uid, feature, force);
}
