import { z } from "zod";
import { entity, serverMask, id } from "./common";
import { slug } from "./normalize";

/** URL name of an artist: /artists/{slug}/... Lowercase words joined by single hyphens ("ingrid-avison"). Unique (artists.create/update check). */
export const ARTIST_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const artistSlug = z.string()
  .min(2, "Use at least 2 characters")
  .max(60, "Use at most 60 characters")
  .regex(ARTIST_SLUG_RE, "Use lowercase letters, numbers and single hyphens (like ingrid-avison)");
/** The slug an artist name suggests ("Ingrid Avison Band" -> "ingrid-avison-band"). Callers still check it is free. */
export const slugForArtist = (name: string) => slug(name).slice(0, 60).replace(/-+$/, "") || "artist";

export const Configuration = z.strictObject({
  id,
  name: z.string().min(1),
  billingName: z.string().min(1),
  musicianIds: z.array(id),
});
/** One of the artist's own per-song facts ("Capo", "Tuning"): defined once here, filled in per song (Song.fields, keyed by this id so a rename keeps the values). */
export const SongField = z.strictObject({ id, label: z.string().min(1) });
/** A custom field definition for shows is the same shape as one for songs. */
export const ShowField = SongField;
/** The artist's public links, one per platform, in the order the Artist page lists them. */
export const ARTIST_LINKS = [
  ["website", "Website"], ["spotify", "Spotify"], ["appleMusic", "Apple Music"], ["bandcamp", "Bandcamp"],
  ["youtube", "YouTube"], ["instagram", "Instagram"], ["tiktok", "TikTok"], ["facebook", "Facebook"],
  ["tidal", "Tidal"], ["linktree", "Linktree"], ["bandsintown", "Bandsintown"],
] as const;
export type ArtistLinkKey = (typeof ARTIST_LINKS)[number][0];
const ArtistLinks = z.strictObject(Object.fromEntries(ARTIST_LINKS.map(([k]) => [k, z.string().optional()])) as Record<ArtistLinkKey, z.ZodOptional<z.ZodString>>);

export const Artist = entity({
  name: z.string().min(1),
  slug: artistSlug,
  configurations: z.array(Configuration),
  links: ArtistLinks,
  driveFolderId: z.string(),
  /** Ordered; the song page lists a song's values in this order. Changed only by artists.addSongField & co (removing one strips its values from songs). */
  songFields: z.array(SongField).default([]),
  /** Same, for shows: filled in on the show page's Custom fields card (Show.fields). Changed only by artists.addShowField & co. */
  showFields: z.array(SongField).default([]),
});
export const ArtistInput = Artist.omit(serverMask);
export type Artist = z.infer<typeof Artist>;
export type SongField = z.infer<typeof SongField>;
export type ShowField = SongField;
export type Configuration = z.infer<typeof Configuration>;
