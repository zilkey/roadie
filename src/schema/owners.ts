/**
 * What every kind (collection) belongs to: the multi-tenancy plan's owner table (D1). No Zod import, so the browser can use it.
 *
 * - `artist`: one artist's record; it carries `artistId` (stamped by the Writer, src/server/db.ts).
 * - `artist-self`: the artist's own doc (`artists/{id}`): its id is the artistId.
 * - `shared`: the shared directory, one record every artist sees (venues, acts…).
 * - `user`: one person's (their users doc, prefs, drafts, Google grant, Roadie messages).
 * - `history`: History entries; each carries one scope (artistId, ownerUid or shared).
 * - `server`: server-only bookkeeping no browser reads.
 *
 * Sub-collections are keyed by their own name (`comments`, `messages`, `private`), the way `kindOf` names them.
 * tests/unit/owners.test.ts fails when a kind in `collections`, SERVER_KEPT, firestore.rules or a `collection("…")` literal is missing here.
 */
export type Owner = "artist" | "artist-self" | "shared" | "user" | "history" | "server";

export const OWNERS = {
  // artist
  invites: "artist", shows: "artist", comments: "artist", showDeals: "artist", setlists: "artist", tours: "artist", entries: "artist",
  pitches: "artist", activity: "artist", campaigns: "artist", contacts: "artist", projects: "artist", income: "artist", payouts: "artist",
  expenses: "artist", releases: "artist", tracks: "artist", songs: "artist", files: "artist", setlistTemplates: "artist", rehearsals: "artist",
  stagePlots: "artist", availability: "artist", musicians: "artist", emailTemplates: "artist", statSnapshots: "artist",
  checklistTemplates: "artist", posts: "artist", todos: "artist", fans: "artist", emailThreads: "artist", venueNotes: "artist",
  venueEventNotes: "artist", actNotes: "artist", festivalNotes: "artist", editionNotes: "artist", promoterNotes: "artist",
  contactNotes: "artist", socialChecklists: "artist", mcpTokens: "artist", shortcutTokens: "artist", assistantThreads: "artist",
  sites: "artist", sitePages: "artist", siteSources: "artist", siteAssets: "artist", siteVersions: "artist",
  // the artist's own doc
  artists: "artist-self",
  // shared directory
  venues: "shared", venueTypes: "shared", venueEvents: "shared", venueEventSources: "shared", acts: "shared", promoters: "shared",
  festivals: "shared", editions: "shared", fuelPrices: "shared",
  // one person's
  users: "user", private: "user", userPrefs: "user", unsubmittedDrafts: "user", googleGrants: "user", messages: "user", pending: "user",
  history: "history",
  // server only
  mutations: "server", routeCache: "server", geocodes: "server", metaConnections: "server", stagePlotTokens: "server",
  assistantStops: "server", ledger: "server", platform: "server", platformUsers: "server", platformArtists: "server",
  sharedEditRequests: "server", usage: "server", artistLinks: "server",
} as const satisfies Record<string, Owner>;

export type Kind = keyof typeof OWNERS;

export const ownerOf = (kind: string): Owner | undefined => (OWNERS as Record<string, Owner>)[kind];
export const isArtistKind = (kind: string) => ownerOf(kind) === "artist";
export const isSharedKind = (kind: string) => ownerOf(kind) === "shared";

/**
 * Sub-collections and id-keyed kinds: where their artist comes from. A sub-collection lives under its parent's doc; `showDeals`
 * and `setlists` are keyed by their show's id.
 */
export const PARENTS: Record<string, { kinds: readonly string[]; keyedById?: true }> = {
  comments: { kinds: ["shows", "pitches"] },
  activity: { kinds: ["pitches"] },
  entries: { kinds: ["tours"] },
  tracks: { kinds: ["releases"] },
  messages: { kinds: ["assistantThreads"] },
  pending: { kinds: ["assistantThreads"] },
  private: { kinds: ["users"] },
  showDeals: { kinds: ["shows"], keyedById: true },
  setlists: { kinds: ["shows"], keyedById: true },
  sitePages: { kinds: ["sites"] },
  siteSources: { kinds: ["sites"] },
  siteAssets: { kinds: ["sites"] },
  siteVersions: { kinds: ["sites"] },
};

/**
 * Artist kinds that stay top level even when artist data is nested (tenancy phase 10): they are looked up by a hash or an id
 * before any artist is known (MCP keys, Shortcut tokens, invites a person answers before joining) or are server-kept transcripts
 * keyed by an id the whole Roadie flow passes around on its own (assistantThreads, with their messages and pending cards).
 * Each still carries `artistId`.
 */
export const STAYS_TOP = new Set<string>(["mcpTokens", "shortcutTokens", "invites", "assistantThreads"]);
/** Does this top-level kind live under `artists/{id}/…` when nested? Every artist kind except STAYS_TOP. */
export const movesUnderArtist = (kind: string) => isArtistKind(kind) && !STAYS_TOP.has(kind);

/**
 * Where artist data lives (phase 10): `false` = top-level collections (`shows/{id}`), `true` = under its artist
 * (`artists/{artistId}/shows/{id}`). The server reads it from `platform/config.nestedPaths` (src/server/layout.ts); the browser gets it
 * with the session (src/lib/auth.tsx). `ROADIE_NESTED_PATHS=1|0` overrides it (tests, scripts).
 */
let nested = !(typeof process !== "undefined" && process.env?.ROADIE_NESTED_PATHS === "0");
export const nestedPaths = () => nested;
export function setNestedPaths(on: boolean) { nested = on; }

/**
 * A path as code writes it ("logical": `shows`, `pitches/{id}/comments`, `shows/{id}/history`) from a stored one, and the artist it's
 * under when it is nested (`artists/{a}/shows` → `shows`, a). Logical paths pass through unchanged.
 */
export function splitPath(path: string): { logical: string; artistId?: string } {
  const s = path.split("/").filter(Boolean);
  if (s[0] === "artists" && s.length >= 3 && movesUnderArtist(s[2])) return { logical: s.slice(2).join("/"), artistId: s[1] };
  return { logical: s.join("/") };
}
/** Does a logical path move under its artist when nested? Its first segment decides (sub-collections and History go with their record). */
export const movesPath = (logical: string) => movesUnderArtist(logical.split("/")[0]);
/** The stored path of a logical one in the current layout (`nested`, default the current flag). */
export function physicalPath(logical: string, artistId: string | null | undefined, nest = nested): string {
  if (!nest || !movesPath(logical)) return logical;
  if (!artistId) throw new Error(`"${logical}" lives under its artist: the artistId is needed`);
  return `artists/${artistId}/${logical}`;
}
/**
 * Is a stored document path in the current layout? Nested: artist data only under `artists/{a}/…`; flat: only at the top. Shared,
 * person and server data (and their History) are top level in both. Collection-group results go through this, so the copies the
 * other layout still holds (between phase 10's copy and its delete step) are never shown twice.
 */
export function inLayout(docPath: string, nest = nested): boolean {
  const s = docPath.split("/");
  if (s[0] === "artists" && s.length >= 4 && movesUnderArtist(s[2])) return nest;
  return movesUnderArtist(s[0]) ? !nest : true;
}

/**
 * The collection path of a kind: the kind itself, or `{parentKind}/{parentId}/{kind}` for a sub-collection; when artist data is nested
 * (phase 10) an artist kind's is under `artists/{artistId}/`. `artistId` is required for artist kinds, and for a sub-collection of one.
 */
export function pathOf(kind: string, at: { artistId?: string | null; parent?: { kind: string; id: string } } = {}): string {
  const owner = ownerOf(kind);
  if (!owner) throw new Error(`No owner for kind "${kind}" (src/schema/owners.ts)`);
  if (owner === "artist" && !at.artistId) throw new Error(`pathOf("${kind}") needs the artistId`);
  const p = PARENTS[kind];
  if (p && !p.keyedById) {
    if (!at.parent) throw new Error(`pathOf("${kind}") needs its parent`);
    if (!p.kinds.includes(at.parent.kind)) throw new Error(`"${kind}" doesn't live under "${at.parent.kind}"`);
    return physicalPath(`${at.parent.kind}/${at.parent.id}/${kind}`, at.artistId);
  }
  return physicalPath(kind, at.artistId);
}
