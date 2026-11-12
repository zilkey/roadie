import { z } from "zod";
import { entity, serverMask, id } from "./common";
import { slug } from "./normalize";

/** URL name of an artist: /artists/{slug}/... Lowercase words joined by single hyphens ("nora-quill"). Unique (artists.create/update check). */
export const ARTIST_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const artistSlug = z.string()
  .min(2, "Use at least 2 characters")
  .max(60, "Use at most 60 characters")
  .regex(ARTIST_SLUG_RE, "Use lowercase letters, numbers and single hyphens (like nora-quill)");
/** The slug an artist name suggests ("Nora Quill Band" -> "nora-quill-band"). Callers still check it is free. */
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
  /** One line saying what the field holds ("Capo fret with the guitar tuned down a half step to Eb"): help text under the value, a tooltip on the column header, and read by Roadie. Missing = none, never an empty string. */
  description: z.string().optional(),
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
export const ArtistLinks = z.strictObject(Object.fromEntries(ARTIST_LINKS.map(([k]) => [k, z.string().optional()])) as Record<ArtistLinkKey, z.ZodOptional<z.ZodString>>);
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

/** One line of the merch price list on the public fan page (/f/{slug}). Order is the list's order. Money is integer cents. */
export const MerchItem = z.strictObject({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1, "Give the item a name").max(60),
  priceCents: z.number().int().min(0).max(1_000_000),
});
export type MerchItem = z.infer<typeof MerchItem>;
/** One of the fan page's own links ("New single", "Tour poster"): a name and an http(s) URL. Order is the list's order. */
export const FanLink = z.strictObject({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1, "Give the link a name").max(60),
  url: z.string().trim().max(500).regex(/^https?:\/\/\S+\.\S+$/i, "Use a full web address, like https://example.com"),
});
export type FanLink = z.infer<typeof FanLink>;
/** The longest logo data URL the artist document takes (about 200 KB of image). */
export const MAX_LOGO_CHARS = 280_000;
/** The look of the public fan page. Missing = follow the phone's light/dark setting and Roadie's blue. */
export const FanPageStyle = z.strictObject({
  theme: z.enum(["auto", "light", "dark"]).optional(),
  /** "#rrggbb": buttons, the eyebrow and the dot. */
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #5561e8").optional(),
});
export type FanPageStyle = z.infer<typeof FanPageStyle>;

/** The opt-in line on the public list page when the artist hasn't written their own. */
export const DEFAULT_LIST_WORDING = "By joining you'll get email from us about shows and music, about once a month. Unsubscribe from any email.";

export const Artist = entity({
  name: z.string().min(1),
  /** The URL name. The public fan pages (/f/{slug}, /m/{slug}) use it too, so changing it changes those links. */
  slug: artistSlug,
  configurations: z.array(Configuration),
  links: ArtistLinks,
  /** What the band plays, lowercase ("americana", "indie folk"), set on General Settings. Booking's opener guess (#79) moves a show up when the headliner's genres fit these. Missing = none. */
  genres: z.array(z.string().min(1)).optional(),
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
  /** The name the public fan page shows ("Ingrid Avison" for "Ingrid Avison Band"). Missing = name. */
  publicName: z.string().trim().max(80).optional(),
  /** The merch price list on the public fan page, in order. Shown when features.merch is on and paymentUrl is set. */
  merchItems: z.array(MerchItem).max(50).optional(),
  fanPageStyle: FanPageStyle.optional(),
  /** True hides the fan page's "Leave a tip" button (Fan Page › Money). Missing = the button shows whenever there is a Venmo link. */
  hideTips: z.boolean().optional(),
  /** The fan page's own links, in order, listed under merch. */
  fanLinks: z.array(FanLink).max(30).optional(),
  /**
   * The logo the fan page shows instead of the name: a small image as a data URL (the Fan Page shrinks it in the browser before
   * saving, so it stays well under the document limit). Missing = the name in big letters.
   */
  logo: z.strictObject({
    dataUrl: z.string().max(MAX_LOGO_CHARS, "That image is too big. Try a smaller one.").regex(/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/, "Use a PNG, WebP or JPEG image"),
  }).optional(),
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
   * The Socials folder (Settings › Google; the UI used to call it the Posts folder), in the band's Shared Drive: anyone in the
   * band drops photos into it, loose or in folders of any name. Everything in it except its Posts/ folder is the inbox (photos
   * not used in a post yet); Posts/ holds one folder per post, "DRAFT - <title>" and then "YYYY-MM-DD - <title>" once it goes
   * out (docs/designs/posts-carousels/folder-model.md). Set only by google.setPostsFolder.
   */
  postsFolderId: z.string().optional(),
  /** Socials/Posts, the folder of post folders. Set only by posts.setup; cleared when the Socials folder changes. */
  postFoldersId: z.string().optional(),
  /** The Releases folder: "Create" on a release makes the release's folder inside it. Set only by google.setReleasesFolder. */
  releasesFolderId: z.string().optional(),
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
  /**
   * The booking mailbox: the admin whose Gmail every admin's email sends, drafts and searches go through (src/server/commands/email.ts
   * accountOf). Only that admin can set it, to themself (google.useForBookingMail). Null or missing: each admin uses their own Gmail.
   */
  bookingMail: z.strictObject({ uid: z.string(), email: z.string() }).nullable().optional(),
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
