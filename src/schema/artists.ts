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
export const SongField = z.strictObject({
  id,
  label: z.string().min(1),
  /** Also a column in the Songs (or Shows) list table. Missing = no. */
  inTable: z.boolean().optional(),
});
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
/** A Signal group invite link. Anyone who has it can join the group. */
export const SIGNAL_GROUP_PREFIX = "https://signal.group/#";
export const SIGNAL_NO_KEY = "That Signal group link has nothing after the #. Copy the whole link from Signal.";
export const SIGNAL_NOT_GROUP = `Use a Signal group link (${SIGNAL_GROUP_PREFIX}...)`;
/**
 * However the group link was pasted (https, http, no scheme, sgnl://, stray spaces), the one stored form: https://signal.group/#<key>.
 * An error message instead when it isn't a signal.group link or has no key after the #.
 */
export function normalizeSignalGroupUrl(input: string): { url: string } | { error: string } {
  const v = input.replace(/\s+/g, "");
  const m = /^(?:(?:https?|sgnl):\/\/)?signal\.group\/?#(.*)$/i.exec(v);
  if (!m) return { error: SIGNAL_NOT_GROUP };
  return m[1] ? { url: SIGNAL_GROUP_PREFIX + m[1] } : { error: SIGNAL_NO_KEY };
}
/** The link that opens the group in Signal Desktop, from the stored https one. */
export const signalAppUrl = (groupUrl: string) => groupUrl.replace(/^https:\/\//, "sgnl://");
export const signalGroupUrl = z.string().transform((v, ctx) => {
  const r = normalizeSignalGroupUrl(v);
  if ("url" in r) return r.url;
  ctx.addIssue({ code: "custom", message: r.error });
  return z.NEVER;
});

export const Artist = entity({
  name: z.string().min(1),
  slug: artistSlug,
  configurations: z.array(Configuration),
  links: ArtistLinks,
  /**
   * The band's Signal group (Who's free can post there). Private, unlike `links`: anyone with it can join the group, so it
   * never goes into booking templates, emails, Bandsintown, calendar sync or the /ask pages.
   */
  signalGroupUrl: signalGroupUrl.optional(),
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
