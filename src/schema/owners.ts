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
  sharedEditRequests: "server", usage: "server",
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
};

/**
 * The collection path of a kind: the kind itself, or `{parentKind}/{parentId}/{kind}` for a sub-collection. `artistId` is required
 * for artist kinds even though today's paths don't use it (phase 10 moves artist data under `artists/{id}/…` by changing this).
 */
export function pathOf(kind: string, at: { artistId?: string | null; parent?: { kind: string; id: string } } = {}): string {
  const owner = ownerOf(kind);
  if (!owner) throw new Error(`No owner for kind "${kind}" (src/schema/owners.ts)`);
  if (owner === "artist" && !at.artistId) throw new Error(`pathOf("${kind}") needs the artistId`);
  const p = PARENTS[kind];
  if (p && !p.keyedById) {
    if (!at.parent) throw new Error(`pathOf("${kind}") needs its parent`);
    if (!p.kinds.includes(at.parent.kind)) throw new Error(`"${kind}" doesn't live under "${at.parent.kind}"`);
    return `${at.parent.kind}/${at.parent.id}/${kind}`;
  }
  return kind;
}
