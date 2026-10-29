/**
 * Named routes: the only places Roadie's `ui.navigate` can send the browser. Never a raw URL.
 * Every band page lives under its artist: `path` is relative to `/artists/{slug}` (see `artistPath`), so a route always
 * resolves inside the artist you're working in.
 */
import { defaultPrintOptions, parsePrintQuery, printQuery } from "./print";

export interface RouteDef { title: string; path: string; params?: readonly string[] }

export const ROUTES = {
  shows: { title: "Shows", path: "/shows" },
  calendar: { title: "Calendar", path: "/calendar" },
  showsPlayed: { title: "Played shows", path: "/shows#played" },
  showsCanceled: { title: "Canceled shows", path: "/shows#canceled" },
  showsDropped: { title: "Dropped shows", path: "/shows#dropped" },
  show: { title: "Show", path: "/shows/:id", params: ["id"] },
  showSetlist: { title: "Show setlist", path: "/shows/:id?tab=setlist", params: ["id"] },
  showFinances: { title: "Show finances", path: "/shows/:id?tab=finances", params: ["id"] },
  showAfter: { title: "After the show", path: "/shows/:id/after", params: ["id"] },
  newShow: { title: "New show", path: "/shows/new" },
  booking: { title: "Booking", path: "/booking" },
  bookingPitches: { title: "Pitch List", path: "/booking/pitches" },
  bookingVenues: { title: "Venues", path: "/booking/venues" },
  bookingFestivals: { title: "Festivals", path: "/booking/festivals" },
  bookingPromoters: { title: "Promoters", path: "/booking/promoters" },
  bookingContacts: { title: "Contacts", path: "/booking/contacts" },
  venue: { title: "Venue", path: "/booking/venues/:id", params: ["id"] },
  promoter: { title: "Promoter", path: "/booking/promoters/:id", params: ["id"] },
  festival: { title: "Festival", path: "/booking/festivals/:id", params: ["id"] },
  edition: { title: "Festival year", path: "/booking/editions/:id", params: ["id"] },
  contact: { title: "Contact", path: "/booking/contacts/:id", params: ["id"] },
  pitch: { title: "Pitch", path: "/booking/pitches/:id", params: ["id"] },
  emailNew: { title: "New email", path: "/booking/email/new" },
  emailSearch: { title: "Search Gmail", path: "/booking/email/search" },
  emailThread: { title: "Email thread", path: "/booking/email/:id", params: ["id"] },
  bookingTemplates: { title: "Email templates", path: "/booking/templates" },
  songs: { title: "Songs", path: "/songs" },
  song: { title: "Song", path: "/songs/:id", params: ["id"] },
  albums: { title: "Albums", path: "/albums" },
  newAlbum: { title: "New album", path: "/albums/new" },
  album: { title: "Album", path: "/albums/:id", params: ["id"] },
  albumMoney: { title: "Album money", path: "/albums/:id?tab=money", params: ["id"] },
  albumFiles: { title: "Album files", path: "/albums/:id?tab=files", params: ["id"] },
  albumTrack: { title: "Album track", path: "/albums/:id/tracks/:trackId", params: ["id", "trackId"] },
  setlists: { title: "Setlist Templates", path: "/setlists" },
  setlist: { title: "Setlist template", path: "/setlists/:id", params: ["id"] },
  setlistPrint: { title: "Print setlist", path: "/setlists/:id/print", params: ["id"] },
  rehearsals: { title: "Rehearsals", path: "/rehearsals" },
  rehearsal: { title: "Rehearsal", path: "/rehearsals/:id", params: ["id"] },
  stagePlots: { title: "Stage plots", path: "/stage-plots" },
  stagePlot: { title: "Stage plot", path: "/stage-plots/:id", params: ["id"] },
  money: { title: "Money", path: "/money" },
  fans: { title: "Fans", path: "/fans" },
  expense: { title: "New expense", path: "/money/expense" },
  projects: { title: "Projects", path: "/money/projects" },
  project: { title: "Project", path: "/money/projects/:id", params: ["id"] },
  artist: { title: "General", path: "/admin/artist" },
  lineups: { title: "Lineups", path: "/admin/lineups" },
  fields: { title: "Custom fields", path: "/admin/fields" },
  people: { title: "People", path: "/admin/people" },
  google: { title: "Google", path: "/admin/google" },
  mcp: { title: "Integrations", path: "/admin/mcp" },
  history: { title: "Activity", path: "/admin/history" },
} as const satisfies Record<string, RouteDef>;

/** Record pages: route name -> the collection its `id` param lives in (what `records.get` takes). */
export const RECORD_ROUTES = {
  show: "shows", venue: "venues", promoter: "promoters", festival: "festivals", edition: "editions", contact: "contacts",
  pitch: "pitches", emailThread: "emailThreads", song: "songs", setlist: "setlistTemplates", rehearsal: "rehearsals", stagePlot: "stagePlots", showAfter: "shows",
  showSetlist: "shows", showFinances: "shows", project: "projects", album: "albums", albumMoney: "albums", albumFiles: "albums",
} as const satisfies Partial<Record<keyof typeof ROUTES, string>>;
/** The page for one record of a collection (null when there is none). */
export const routeForRecord = (kind: string): keyof typeof RECORD_ROUTES | null =>
  (Object.entries(RECORD_ROUTES).find(([n, k]) => k === kind && !["showAfter", "showSetlist", "showFinances", "albumMoney", "albumFiles"].includes(n))?.[0] as keyof typeof RECORD_ROUTES | undefined) ?? null;

export type RouteName = keyof typeof ROUTES;
export const routeNames = Object.keys(ROUTES) as RouteName[];
export const isRouteName = (n: unknown): n is RouteName => typeof n === "string" && Object.hasOwn(ROUTES, n);

/** The page that lists your artists (and picks one when you belong to several). */
export const ARTISTS_PATH = "/artists";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** An app path inside an artist: artistPath("ingrid-avison", "/shows/1") -> "/artists/ingrid-avison/shows/1". */
export function artistPath(slug: string, path = "/calendar"): string {
  return `${ARTISTS_PATH}/${encodeURIComponent(slug)}${path.startsWith("/") ? path : `/${path}`}`;
}
/** Split "/artists/{slug}/rest?q" into the slug and the artist-relative rest ("/calendar" when bare). Null for other paths. */
export function splitArtistPath(path: string): { slug: string; rest: string } | null {
  const m = /^\/artists\/([^/?#]+)(\/[^?#]*)?([?#].*)?$/.exec(path);
  if (!m || !SLUG_RE.test(m[1])) return null;
  const rest = m[2] && m[2] !== "/" ? m[2] : "/calendar";
  return { slug: m[1], rest: rest + (m[3] ?? "") };
}
/**
 * The first path segments of every band page (/shows/1, /booking, /admin/people...). Two jobs: `toArtistHref` scopes an
 * artist-relative link to the current artist, so a section missing here renders its links unscoped and they 404; and old
 * links and bookmarks from before artists had URLs redirect to the same page in the signed-in person's artist.
 */
export const LEGACY_SECTIONS = ["shows", "calendar", "booking", "songs", "albums", "setlists", "rehearsals", "stage-plots", "money", "fans", "admin", "me"] as const;
export const isLegacyPath = (path: string) => LEGACY_SECTIONS.some((s) => path === `/${s}` || path.startsWith(`/${s}/`) || path.startsWith(`/${s}?`));

/**
 * Where sign-in lands for `?next=` (the page that sent a signed-out visitor to /signin): an artist page as is, an old
 * band path through the picker, anything else (another site, /api, nothing) the picker.
 */
export function afterSignIn(next: string | null | undefined): string {
  if (next && splitArtistPath(next)) return next;
  if (next && isLegacyPath(next)) return `${ARTISTS_PATH}?next=${encodeURIComponent(next)}`;
  return ARTISTS_PATH;
}

/**
 * Resolve a route name + params to a path. With `slug`, the href is inside that artist (what the browser navigates to);
 * without, it is the artist-relative path. Null when the name is unknown or a param is missing/unsafe.
 */
export function resolveRoute(name: unknown, params: Record<string, string> = {}, slug?: string): { name: RouteName; href: string; title: string } | null {
  if (!isRouteName(name)) return null;
  if (slug !== undefined && !SLUG_RE.test(slug)) return null;
  const def: RouteDef = ROUTES[name];
  let href = def.path;
  for (const p of def.params ?? []) {
    const v = params[p];
    if (!v || !/^[\w-]+$/.test(v)) return null;
    href = href.replace(`:${p}`, encodeURIComponent(v));
  }
  // The print page's options ride along as `query`, rebuilt from the parsed options so only the allowlisted keys and values get through.
  if (name === "setlistPrint" && params.query) href += `?${printQuery(parsePrintQuery(new URLSearchParams(params.query), defaultPrintOptions(1)))}`;
  return { name, href: slug === undefined ? href : artistPath(slug, href), title: def.title };
}

/**
 * The named route for a pathname, with its params (for pageContext). Takes a full "/artists/{slug}/..." path (the
 * result then carries `artist`) or an artist-relative one. Unknown paths give null.
 */
export function routeForPath(path: string): { route: RouteName; params: Record<string, string>; artist?: string } | null {
  const inArtist = splitArtistPath(path);
  const rel = (inArtist ? inArtist.rest : path).replace(/[?#].*$/, "");
  for (const name of routeNames) { // first match wins, so a page's plain route comes before its ?tab= / #hash variants
    const def: RouteDef = ROUTES[name];
    const re = new RegExp("^" + def.path.replace(/[?#].*$/, "").replace(/:(\w+)/g, "(?<$1>[^/]+)") + "/?$");
    const m = re.exec(rel);
    if (m) return { route: name, params: { ...m.groups }, ...(inArtist ? { artist: inArtist.slug } : {}) };
  }
  return null;
}
