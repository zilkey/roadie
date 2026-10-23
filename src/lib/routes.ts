/** Named routes: the only places Roadie's `ui.navigate` can send the browser. Never a raw URL. */
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
  users: { title: "Users", path: "/admin/users" },
  musicians: { title: "Musicians", path: "/admin/musicians" },
  artist: { title: "Artist & gear", path: "/admin/artist" },
  aiKeys: { title: "AI keys", path: "/admin/ai-keys" },
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

/** Resolve a route name + params to a path. Null when the name is unknown or a param is missing/unsafe. */
export function resolveRoute(name: unknown, params: Record<string, string> = {}): { name: RouteName; href: string; title: string } | null {
  if (!isRouteName(name)) return null;
  const def: RouteDef = ROUTES[name];
  let href = def.path;
  for (const p of def.params ?? []) {
    const v = params[p];
    if (!v || !/^[\w-]+$/.test(v)) return null;
    href = href.replace(`:${p}`, encodeURIComponent(v));
  }
  return { name, href, title: def.title };
}

/** The named route for a pathname, with its params (for pageContext). Unknown paths give null. */
export function routeForPath(path: string): { route: RouteName; params: Record<string, string> } | null {
  for (const name of routeNames) {
    const def: RouteDef = ROUTES[name];
    const re = new RegExp("^" + def.path.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "/?$");
    const m = re.exec(path);
    if (m) return { route: name, params: { ...m.groups } };
  }
  return null;
}
