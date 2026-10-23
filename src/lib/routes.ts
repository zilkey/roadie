/**
 * Named routes: the only places Roadie's `ui.navigate` can send the browser. Never a raw URL.
 * Every band page lives under its artist: `path` is relative to `/artists/{slug}` (see `artistPath`), so a route always
 * resolves inside the artist you're working in.
 */
export interface RouteDef { title: string; path: string; params?: readonly string[] }

export const ROUTES = {
  home: { title: "Home", path: "/home" },
  shows: { title: "Shows", path: "/shows" },
  show: { title: "Show", path: "/shows/:id", params: ["id"] },
  showAfter: { title: "After the show", path: "/shows/:id/after", params: ["id"] },
  newShow: { title: "New show", path: "/shows/new" },
  booking: { title: "Booking", path: "/booking" },
  venue: { title: "Venue", path: "/booking/venues/:id", params: ["id"] },
  promoter: { title: "Promoter", path: "/booking/promoters/:id", params: ["id"] },
  festival: { title: "Festival", path: "/booking/festivals/:id", params: ["id"] },
  edition: { title: "Festival year", path: "/booking/editions/:id", params: ["id"] },
  contact: { title: "Contact", path: "/booking/contacts/:id", params: ["id"] },
  pitch: { title: "Pitch", path: "/booking/pitches/:id", params: ["id"] },
  bookingTemplates: { title: "Email templates", path: "/booking/templates" },
  songs: { title: "Songs", path: "/songs" },
  song: { title: "Song", path: "/songs/:id", params: ["id"] },
  setlist: { title: "Setlist", path: "/songs/setlists/:id", params: ["id"] },
  rehearsal: { title: "Rehearsal", path: "/songs/rehearsals/:id", params: ["id"] },
  money: { title: "Money", path: "/money" },
  expense: { title: "New expense", path: "/money/expense" },
  stats: { title: "Stats", path: "/stats" },
  artist: { title: "Artist", path: "/admin/artist" },
  people: { title: "People", path: "/admin/people" },
  mcp: { title: "Connect Roadie to Claude", path: "/admin/mcp" },
  history: { title: "History", path: "/admin/history" },
} as const satisfies Record<string, RouteDef>;

/** Record pages: route name -> the collection its `id` param lives in (what `records.get` takes). */
export const RECORD_ROUTES = {
  show: "shows", venue: "venues", promoter: "promoters", festival: "festivals", edition: "editions", contact: "contacts",
  pitch: "pitches", song: "songs", setlist: "setlists", rehearsal: "rehearsals", showAfter: "shows",
} as const satisfies Partial<Record<keyof typeof ROUTES, string>>;
/** The page for one record of a collection (null when there is none). */
export const routeForRecord = (kind: string): keyof typeof RECORD_ROUTES | null =>
  (Object.entries(RECORD_ROUTES).find(([n, k]) => k === kind && n !== "showAfter")?.[0] as keyof typeof RECORD_ROUTES | undefined) ?? null;

export type RouteName = keyof typeof ROUTES;
export const routeNames = Object.keys(ROUTES) as RouteName[];
export const isRouteName = (n: unknown): n is RouteName => typeof n === "string" && Object.hasOwn(ROUTES, n);

/** The page that lists your artists (and picks one when you belong to several). */
export const ARTISTS_PATH = "/artists";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** An app path inside an artist: artistPath("ingrid-avison", "/shows/1") -> "/artists/ingrid-avison/shows/1". */
export function artistPath(slug: string, path = "/home"): string {
  return `${ARTISTS_PATH}/${encodeURIComponent(slug)}${path.startsWith("/") ? path : `/${path}`}`;
}
/** Split "/artists/{slug}/rest?q" into the slug and the artist-relative rest ("/home" when bare). Null for other paths. */
export function splitArtistPath(path: string): { slug: string; rest: string } | null {
  const m = /^\/artists\/([^/?#]+)(\/[^?#]*)?([?#].*)?$/.exec(path);
  if (!m || !SLUG_RE.test(m[1])) return null;
  const rest = m[2] && m[2] !== "/" ? m[2] : "/home";
  return { slug: m[1], rest: rest + (m[3] ?? "") };
}
/**
 * The first path segments of band pages from before artists had URLs (/shows/1, /booking, /admin/people...). Old links
 * and bookmarks to these redirect to the same page in the signed-in person's artist.
 */
export const LEGACY_SECTIONS = ["home", "shows", "booking", "songs", "money", "stats", "admin"] as const;
export const isLegacyPath = (path: string) => LEGACY_SECTIONS.some((s) => path === `/${s}` || path.startsWith(`/${s}/`) || path.startsWith(`/${s}?`));

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
  return { name, href: slug === undefined ? href : artistPath(slug, href), title: def.title };
}

/**
 * The named route for a pathname, with its params (for pageContext). Takes a full "/artists/{slug}/..." path (the
 * result then carries `artist`) or an artist-relative one. Unknown paths give null.
 */
export function routeForPath(path: string): { route: RouteName; params: Record<string, string>; artist?: string } | null {
  const inArtist = splitArtistPath(path);
  const rel = inArtist ? inArtist.rest.replace(/[?#].*$/, "") : path;
  for (const name of routeNames) {
    const def: RouteDef = ROUTES[name];
    const re = new RegExp("^" + def.path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "/?$");
    const m = re.exec(rel);
    if (m) return { route: name, params: { ...m.groups }, ...(inArtist ? { artist: inArtist.slug } : {}) };
  }
  return null;
}
