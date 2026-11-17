/**
 * What the browser's Firestore hooks (src/lib/firestore-hooks.ts) actually ask for: tenancy plan D5. No Firebase import, so it is
 * unit-tested on its own (tests/unit/client-scope.test.ts).
 *
 * - An `artist` kind (src/schema/owners.ts) is asked for with `where("artistId", "==", <the open artist>)`. Without an artist it isn't
 *   asked for at all: the hooks return nothing.
 * - A list of `users` is asked for with `where("artistIds", "array-contains", <the open artist>)`, the people of this artist only.
 * - Every collection path is built by `pathOf`, so moving artist data under `artists/{id}/…` later (phase 10) changes one place.
 */
import { ownerOf, pathOf } from "@/schema/owners";

export type Where = [field: string, op: string, value: unknown];

/** The kind and parent of a collection path as call sites write it: "shows", or "tours/{tourId}/entries". */
export function parsePath(path: string): { kind: string; parent?: { kind: string; id: string } } {
  const s = path.split("/");
  if (s.length === 1) return { kind: s[0] };
  if (s.length === 3) return { kind: s[2], parent: { kind: s[0], id: s[1] } };
  throw new Error(`Not a collection path: "${path}"`);
}

/** The collection path of one doc's collection (for a get by id), or null when it is an artist kind and there's no artist open. */
export function scopedDocPath(path: string, artistId: string | null | undefined): string | null {
  const { kind, parent } = parsePath(path);
  if (ownerOf(kind) === "artist" && !artistId) return null;
  return pathOf(kind, { artistId, parent });
}

/**
 * The collection (or collection-group name) and the filters a list query runs with, or null when it mustn't run: an artist kind
 * (or a list of users) with no artist open. A caller's own `artistId ==` filter is replaced by the open artist's.
 */
export function scopeQuery(path: string, opts: { group?: boolean; where?: readonly Where[] }, artistId: string | null | undefined): { kind: string; path: string; where: Where[] } | null {
  const { kind, parent } = opts.group ? { kind: path, parent: undefined } : parsePath(path);
  const owner = ownerOf(kind);
  if (!owner) throw new Error(`No owner for kind "${kind}" (src/schema/owners.ts)`);
  let where = [...(opts.where ?? [])];
  if (owner === "artist") {
    if (!artistId) return null;
    where = [["artistId", "==", artistId], ...where.filter(([f, op]) => !(f === "artistId" && op === "=="))];
  } else if (kind === "users") {
    if (!artistId) return null;
    where = [["artistIds", "array-contains", artistId], ...where];
  }
  return { kind, path: opts.group ? kind : pathOf(kind, { artistId, parent }), where };
}
