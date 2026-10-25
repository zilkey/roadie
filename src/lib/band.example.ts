/**
 * Template for `src/lib/band.ts`, which is NOT committed (it holds real names and Google addresses, and this is a
 * public repo -- see .gitignore). Copy this file to `src/lib/band.ts`, fill in the real band, and keep it local:
 *
 *   cp src/lib/band.example.ts src/lib/band.ts
 *
 * scripts/seed-real.ts reads it and refuses to run without it. Nothing here is a fixture: src/lib/dev-people.ts is
 * the other one, with fake @example.com people for the dev "Sign in as…" buttons and npm run e2e. Same `DevPerson`
 * shape, so the seeding helpers work against either.
 */
import type { DevPerson } from "./dev-people";
import type { ArtistLinkKey } from "@/schema/artists";

export const BAND_ARTIST_NAME = "Example Band";

/**
 * The real people. Emails must match their Google accounts exactly -- sign-in depends on it, so copy them from
 * something authoritative (the band's calendar invite) rather than typing them from memory. An address that looks
 * like a typo may well be the real one; don't "fix" it.
 *
 * Keys are stable short names. Keep jeff/ingrid/david/emma/eric if you have those people: /api/dev-people offers the
 * seeded roster under these keys and the e2e specs click `dev-${key}`.
 */
export const BAND_PEOPLE: DevPerson[] = [
  { key: "ingrid", name: "First Admin", email: "first-admin@example.com", role: "admin", instruments: ["vocals", "guitar"] },
  { key: "jeff", name: "Second Admin", email: "second-admin@example.com", role: "admin", instruments: ["keys"] },
  { key: "david", name: "Bassist", email: "bassist@example.com", role: "member", instruments: ["bass"] },
  { key: "emma", name: "Lead Guitarist", email: "lead-guitar@example.com", role: "member", instruments: ["lead guitar"] },
  { key: "eric", name: "Drummer", email: "drums@example.com", role: "member", instruments: ["drums"] },
];

/**
 * The configurations the band actually plays as (the four in scripts/seed.ts are demo inventions).
 *
 * A reduced lineup can still be billed as the full band -- that is usually the point of it: the audience sees one
 * name either way, while the personnel list and the pay split don't. The configuration's own name is for the band,
 * and must not leak onto a poster or a contract -- so it is `name`, never `billingName`.
 */
export const BAND_CONFIGURATIONS: { id: string; name: string; billingName: string; keys: string[] }[] = [
  { id: "solo", name: "Solo", billingName: "First Admin", keys: ["ingrid"] },
  { id: "duo", name: "Duo", billingName: "Example Duo", keys: ["ingrid", "jeff"] },
  { id: "full-band", name: "Full Band", billingName: BAND_ARTIST_NAME, keys: ["ingrid", "jeff", "david", "eric", "emma"] },
  { id: "no-lead-guitar", name: "No Lead Guitar", billingName: BAND_ARTIST_NAME, keys: ["ingrid", "jeff", "david", "eric"] },
  { id: "no-bassist", name: "No Bassist", billingName: BAND_ARTIST_NAME, keys: ["ingrid", "jeff", "emma", "eric"] },
];

/**
 * The artist's public links, stored NORMALIZED -- the seed is the one chance to get these clean:
 *   - https, never http;
 *   - no display or tracking parameters (`?lang=en` on a TikTok, `?si=...` on a Spotify share link);
 *   - Spotify must be the artist PAGE (`/artist/{id}`), not an album: ARTIST_LINKS means the artist, and
 *     src/server/integrations/spotify.ts is shaped around an artist id (GET /v1/artists/{id}).
 *
 * Only the eleven keys in ARTIST_LINKS (src/schema/artists.ts) exist, and it is a strict object. A platform with no
 * key is left out rather than smuggled into `website`; adding a key is a one-line change the Artist page picks up.
 * Setting a few of the eleven is a normal state: the page shows an unset link as one available to add.
 */
export const BAND_LINKS: Partial<Record<ArtistLinkKey, string>> = {
  website: "https://example.com",
  spotify: "https://open.spotify.com/artist/0000000000000000000000",
  instagram: "https://instagram.com/exampleband/",
  tiktok: "https://www.tiktok.com/@example.band",
  facebook: "https://www.facebook.com/profile.php?id=000000000000000",
};

/**
 * The band's Signal group invite link (Artist.signalGroupUrl): Who's free can post asks there. Not one of BAND_LINKS: those
 * are public, and anyone with this link can join the group. npm run leak-check treats it as private.
 */
export const BAND_SIGNAL_GROUP_URL: string | undefined = undefined; // "https://signal.group/#..."
