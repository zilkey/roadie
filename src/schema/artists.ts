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
  /** The project (projects/{id}) a new show billed as this configuration belongs to (Full band -> Band, Duo -> Duo). Missing = the default project. */
  defaultProjectId: id.optional(),
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

/** Instagram link: an @handle (or bare handle) becomes https://instagram.com/<handle>; an instagram.com link is kept (https added). */
export const INSTAGRAM_BAD = "Use your @handle or an instagram.com link";
const INSTAGRAM_HANDLE = /^[A-Za-z0-9._]{1,30}$/;
export function normalizeInstagramUrl(input: string): { url: string } | { error: string } {
  const v = input.replace(/\s+/g, "");
  const link = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/i.exec(v);
  if (link) return INSTAGRAM_HANDLE.test(link[1]) ? { url: /^https?:\/\//i.test(v) ? v : `https://${v}` } : { error: INSTAGRAM_BAD };
  const handle = v.replace(/^@/, "");
  return INSTAGRAM_HANDLE.test(handle) ? { url: `https://instagram.com/${handle}` } : { error: INSTAGRAM_BAD };
}

/** The payment apps a "Payment app" link can be. Only Venmo for now; add a case to PAYMENT_APPS to recognise another. */
export type PaymentApp = "venmo";
export const PAYMENT_URL_PREFIX = "https://venmo.com/u/";
export const PAYMENT_NOT_VENMO = "Use a Venmo link (https://venmo.com/u/yourname) or @yourname";
export const PAYMENT_NO_HANDLE = "That Venmo link has no username. Use https://venmo.com/u/yourname or @yourname";
const VENMO_HANDLE = /^[A-Za-z0-9_-]{1,40}$/;
/** Each recognised app: parse whatever was pasted (spaces already removed) into a handle, or null if it isn't this app's. */
const PAYMENT_APPS: { app: PaymentApp; parse: (v: string) => { handle: string } | "no-handle" | null; canonical: (handle: string) => string }[] = [
  {
    app: "venmo",
    canonical: (h) => PAYMENT_URL_PREFIX + h,
    parse(v) {
      if (v.startsWith("@")) return VENMO_HANDLE.test(v.slice(1)) ? { handle: v.slice(1) } : "no-handle";
      const m = /^(?:https?:\/\/)?(?:www\.)?(?:account\.)?venmo\.com\/(?:u\/)?([^/?#]*)\/?(?:[?#].*)?$/i.exec(v);
      if (!m) return null;
      return VENMO_HANDLE.test(m[1]) && m[1].toLowerCase() !== "u" ? { handle: m[1] } : "no-handle";
    },
  },
];
/**
 * However the payment link was pasted (https://venmo.com/u/x, venmo.com/x, account.venmo.com/u/x, @x, no scheme, stray spaces),
 * the one stored form: https://venmo.com/u/<handle>. An error message instead when it isn't a recognised payment app or has no handle.
 */
export function normalizePaymentUrl(input: string): { url: string } | { error: string } {
  const v = input.replace(/\s+/g, "");
  for (const a of PAYMENT_APPS) {
    const r = a.parse(v);
    if (r === "no-handle") return { error: PAYMENT_NO_HANDLE };
    if (r) return { url: a.canonical(r.handle) };
  }
  return { error: PAYMENT_NOT_VENMO };
}
/** Which app a stored payment link is for, and the handle in it. null when it isn't a recognised link. */
export function paymentAppOf(url: string): { app: PaymentApp; handle: string } | null {
  const v = url.replace(/\s+/g, "");
  for (const a of PAYMENT_APPS) {
    const r = a.parse(v);
    if (r && r !== "no-handle") return { app: a.app, handle: r.handle };
  }
  return null;
}
export const paymentUrl = z.string().transform((v, ctx) => {
  const r = normalizePaymentUrl(v);
  if ("url" in r) return r.url;
  ctx.addIssue({ code: "custom", message: r.error });
  return z.NEVER;
});

/** The opt-in line on the public list page when the artist hasn't written their own. */
export const DEFAULT_LIST_WORDING = "By joining you'll get email from us about shows and music, about once a month. Unsubscribe from any email.";

export const Artist = entity({
  name: z.string().min(1),
  /** The URL name. The public fan pages (/f/{slug}, /m/{slug}) use it too, so changing it changes those links. */
  slug: artistSlug,
  configurations: z.array(Configuration),
  links: ArtistLinks,
  /**
   * The band's Signal group (Who's free can post there). Private, unlike `links`: anyone with it can join the group, so it
   * never goes into booking templates, emails, Bandsintown, calendar sync or the /ask pages.
   */
  signalGroupUrl: signalGroupUrl.optional(),
  /** The payment app link the merch page opens with the amount filled in (Venmo for now). Private like signalGroupUrl: band-only, never in templates, emails, Bandsintown, calendar sync or the /ask pages. */
  paymentUrl: paymentUrl.optional(),
  /** Which fan modules are on. Missing = off. Off hides the nav items and the public pages. */
  features: z.strictObject({ fans: z.boolean().optional(), merch: z.boolean().optional() }).optional(),
  /** The opt-in wording fans see on the public list page (saved with each signup). Missing = DEFAULT_LIST_WORDING. */
  listWording: z.string().optional(),
  driveFolderId: z.string(),
  /** Where recordings uploaded from a rehearsal go, one "{date} Rehearsal" folder per rehearsal inside it. Set only by google.setRehearsalFolder. */
  rehearsalFolderId: z.string().optional(),
  /** The iCloud link that installs the band's "Send to Roadie" Shortcut (Settings > Google). Set only by shortcut.setInstallUrl. */
  shortcutUrl: z.string().url().nullable().optional(),
  /** Where lyrics, chord sheets and other charts go: Copy to band folder puts its copies here. Set only by google.setChartsFolder. */
  chartsFolderId: z.string().optional(),
  /** Where audio uploaded to a song goes (demos, voice memos, mixes). Set only by google.setDemosFolder. */
  demosFolderId: z.string().optional(),
  /** Where audio uploaded to a song in the Writing phase goes (work tapes, voice memos). Set only by google.setSongwritingFolder. */
  songwritingFolderId: z.string().optional(),
  /** The Shows folder: a poster uploaded to a show goes into a "{date} {venue}" folder inside it, made on the first upload. Set only by google.setShowsFolder. */
  showsFolderId: z.string().optional(),
  /**
   * The band's shared Google Calendar: show and rehearsal events go here when an admin sends them (src/server/calendarSync.ts),
   * written with that admin's own Google grant. Its name as it was when chosen. Set only by google.setCalendar.
   */
  calendar: z.strictObject({ id: z.string(), name: z.string() }).nullable().optional(),
  /**
   * The band's Google account: the admin whose Google grant looks things up in Drive
   * (src/server/google/band.ts). Set only by the google.* commands; null or missing until an admin connects one.
   */
  google: z.strictObject({ uid: z.string(), email: z.string() }).nullable().optional(),
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
