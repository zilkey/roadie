/**
 * The band's Google account: the admin whose grant Drive lookups use, kept on the artist as `google: {uid, email}`. The
 * first admin to connect Calendar or Drive becomes it; another admin can take over on Settings > Google. Gmail and
 * Calendar never use it: mail goes through the booking mailbox (bookingMailOf) or each admin's own account, and calendar events go on the band calendar as the
 * admin who sends them (src/server/calendarSync.ts).
 */
import { firestore } from "../admin";
import { IntegrationError } from "../integrations/http";
import { accessTokenFor } from "./grants";
import type { GoogleFeature } from "./oauth";

export interface BandGoogle { uid: string; email: string }

/**
 * One artist's own doc by its id (folders, band account, booking mailbox). The id always comes from the caller's ctx or a
 * verified link; this file is on the system-view allow-list (tests/unit/tenancy-guard.test.ts).
 */
export async function artistDoc(artistId: string): Promise<Record<string, unknown> | null> {
  const snap = await firestore().doc(`artists/${artistId}`).get();
  return snap.exists ? (snap.data() ?? null) : null;
}

/** The artist's band account. */
export async function bandGoogle(artistId: string): Promise<BandGoogle | null> {
  return ((await artistDoc(artistId))?.google as BandGoogle | undefined) ?? null;
}

export async function bandToken(artistId: string, feature: GoogleFeature, force?: boolean): Promise<string> {
  const g = await bandGoogle(artistId);
  if (!g) throw new IntegrationError(feature, 401, "The band has no Google account for Drive yet. An admin connects one on Settings > Google.");
  return accessTokenFor(g.uid, feature, force);
}

/**
 * The booking mailbox, kept on the artist as `bookingMail: {uid, email}`: the admin whose Gmail every admin's email goes
 * through (src/server/commands/email.ts). Only that admin can set it, to themself (google.useForBookingMail). Null: each
 * admin uses their own Gmail.
 */
export async function bookingMailOf(artistId: string): Promise<BandGoogle | null> {
  return ((await artistDoc(artistId))?.bookingMail as BandGoogle | undefined) ?? null;
}
