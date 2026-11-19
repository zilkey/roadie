/**
 * Backup and restore of the whole database as JSON. Used by scripts/backup.ts and scripts/restore.ts.
 * One file per top-level collection; sub-collection documents (pitches/{id}/activity ...) are in their parent's file,
 * each row carrying its full `path`. Firestore timestamps are written as {"__ts": {seconds, nanoseconds}}.
 *
 * Restore is the one deliberate exception to "one door for writes": it writes documents exactly as they were
 * (ids, timestamps, runIds, history) so it does not go through db.ts, but every document with a schema is validated first.
 * What has none by design (SERVER_KEPT below) is restored as it was; a collection nobody listed is refused.
 */
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { collections, commonShape, computedFields, kindOf } from "@/schema";
import { PARENTS, ownerOf, splitPath } from "@/schema/owners";
import { artistIdsOf, type Membership } from "@/schema/users";
import { DEFAULT_TIME_ZONE } from "@/lib/timezone";

export interface BackupRow { path: string; data: Record<string, unknown> }
export type Dump = Record<string, BackupRow[]>;

export function encode(v: unknown): unknown {
  if (v instanceof Timestamp) return { __ts: { seconds: v.seconds, nanoseconds: v.nanoseconds } };
  if (v instanceof Date) return encode(Timestamp.fromDate(v));
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}
export function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("__ts" in o && Object.keys(o).length === 1) {
      const t = o.__ts as { seconds: number; nanoseconds: number };
      return new Timestamp(t.seconds, t.nanoseconds);
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

/** Run at most `n` tasks at once. A task must not wait on another task of the same limiter while it holds a slot. */
function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < n) active++; else await new Promise<void>((r) => queue.push(r)); // a finishing task hands its slot over
    try { return await task(); } finally { const next = queue.shift(); if (next) next(); else active--; }
  };
}

export interface WalkOpts {
  /** Top-level collections to leave out. */
  skip?: Set<string>;
  /** Requests in flight at once (default 32). */
  concurrency?: number;
  /** Called as documents come in, with the running count. */
  onProgress?(docs: number): void;
}

/**
 * Every document in the project, sub-collections included, by top-level collection (each one present, even when empty).
 * Each collection is read with one query and its documents' sub-collections are listed `concurrency` at a time, so the walk
 * is not two round trips per document, one after the other. Documents that exist only as parents of sub-collections are
 * walked into but not returned. Shared by the backup and the wipe, so what is deleted is what was backed up.
 */
export async function walkDocs(fs: Firestore, opts: WalkOpts = {}): Promise<Record<string, FirebaseFirestore.QueryDocumentSnapshot[]>> {
  const out: Record<string, FirebaseFirestore.QueryDocumentSnapshot[]> = {};
  const limit = limiter(opts.concurrency ?? 32);
  let seen = 0;
  async function walk(col: FirebaseFirestore.CollectionReference, top: string) {
    const [refs, snap] = await limit(() => Promise.all([col.listDocuments(), col.get()]));
    out[top].push(...snap.docs);
    seen += snap.size;
    if (snap.size) opts.onProgress?.(seen);
    await Promise.all(refs.map(async (ref) => {
      const subs = await limit(() => ref.listCollections());
      await Promise.all(subs.map((sub) => walk(sub, top)));
    }));
  }
  const tops = (await fs.listCollections()).filter((c) => !opts.skip?.has(c.id));
  for (const col of tops) out[col.id] = [];
  await Promise.all(tops.map((col) => walk(col, col.id)));
  return out;
}

/** Left out of backups: idempotency bookkeeping and personal scratch, both expire on their own (the wipe still clears them). */
export const NOT_BACKED_UP = new Set(["mutations", "unsubmittedDrafts"]);

/** Every document in every collection, sub-collections included (and documents that exist only as parents of them are skipped). */
export async function dumpAll(fs: Firestore, opts: Omit<WalkOpts, "skip"> = {}): Promise<Dump> {
  const dump: Dump = {};
  for (const [top, docs] of Object.entries(await walkDocs(fs, { ...opts, skip: NOT_BACKED_UP }))) {
    dump[top] = docs.map((d) => ({ path: d.ref.path, data: encode(d.data()) as Record<string, unknown> }));
  }
  for (const rows of Object.values(dump)) rows.sort((a, b) => (a.path < b.path ? -1 : 1));
  return dump;
}

const common = z.strictObject(commonShape);
/** Collections kept as data but no longer written or read by the app (the ledger, removed for now): backed up and restored as they are, not validated. */
export const ARCHIVED_COLLECTIONS = new Set(["ledger"]);
/**
 * What the server keeps straight in Firestore, not through db.ts, so it has no common fields, no history and no entry in `collections`:
 * Roadie's threads (with their messages and pending actions), each person's prefs, the Google and Meta connections, stage plot share
 * links, platform-wide settings (platform/config: is sign-up open; platform/admins), approved shared editors and their requests
 * (platformUsers, sharedEditRequests), and the route, geocode and fuel price caches; and, under a person, users/{uid}/private (driving settings before they moved onto
 * users/{uid}.driving; kept so older backups still restore). A backup carries
 * them and restore writes them back as they are, not validated. A collection the server starts keeping this way goes here (or in
 * NOT_BACKED_UP): one in neither list fails the restore with "no schema for collection", on purpose.
 */
export const SERVER_KEPT = new Set(["assistantThreads", "userPrefs", "googleGrants", "metaConnections", "stagePlotTokens", "routeCache", "geocodes", "fuelPrices", "venueEvents", "venueEventSources", "platform", "platformUsers", "platformArtists", "sharedEditRequests", "usage", "artistLinks"]);
const SERVER_KEPT_UNDER: Record<string, Set<string>> = { users: new Set(["private"]) };
/** Restored as it is: an archived or server-kept top-level collection (and everything under it), or a server-kept sub-collection. */
export const isUnvalidated = (parts: string[]) =>
  ARCHIVED_COLLECTIONS.has(parts[0]) || SERVER_KEPT.has(parts[0]) || (parts.length === 4 && !!SERVER_KEPT_UNDER[parts[0]]?.has(parts[2]));

/** Check a decoded document against the collection's Zod schema. Returns error messages (empty = valid). */
export function validateRow(row: BackupRow): string[] {
  if (row.path.split("/").length % 2 !== 0) return [`${row.path}: not a document path`];
  // A nested artist record (tenancy phase 10, `artists/{a}/shows/{id}`) is checked as the record it is (`shows/{id}`).
  const parts = splitPath(row.path).logical.split("/");
  const kind = kindOf(parts.slice(0, -1).join("/"));
  if (isUnvalidated(parts)) return [];
  const def = collections[kind];
  if (!def) return [`${row.path}: no schema for collection "${kind}"`];
  const data = decode(row.data) as Record<string, unknown>;
  const errs: string[] = [];
  const split: Record<string, unknown> = {}, rest: Record<string, unknown> = { ...data };
  for (const k of Object.keys(commonShape)) { split[k] = rest[k]; delete rest[k]; }
  for (const k of computedFields[kind] ?? []) delete rest[k];
  const c = common.safeParse(split);
  if (!c.success) errs.push(...c.error.issues.map((i) => `${row.path}: ${i.path.join(".")} ${i.message}`));
  else if (c.data.id !== parts[parts.length - 1]) errs.push(`${row.path}: id field "${c.data.id}" does not match the document id`);
  const r = def.input.safeParse(rest);
  if (!r.success) errs.push(...r.error.issues.map((i) => `${row.path}: ${i.path.join(".")} ${i.message}`));
  return errs;
}

export function validateDump(dump: Dump): string[] {
  return Object.values(dump).flat().flatMap(validateRow);
}

/** Fields that name an artist record: the record they point at is a parent (as scripts/migrate-tenancy.ts). */
const REF_FIELDS: Record<string, string> = { showId: "shows", pitchId: "pitches", tourId: "tours", releaseId: "releases", songId: "songs", projectId: "projects", rehearsalId: "rehearsals" };

/**
 * Give an older backup's rows their artist in memory (tenancy phase 4 made `artistId` required), with the phase-3 backfill's
 * rules: a record keeps its own; else its parent's (sub-collection, show-keyed, or a record it points at); else the single artist
 * of its ownerUid or creator; else `artistId` (the named artist, for records a script or import made). History entries take
 * their record's scope; a membership takes the person's old `users.musicianId` when that musician is in its artist; users get
 * `artistIds`. Returns how many rows changed. Run before validateDump, so older backups restore into a working state.
 */
export function stampDump(dump: Dump, artistId: string): number {
  const rows = Object.values(dump).flat();
  const byPath = new Map(rows.map((r) => [r.path, r]));
  const dataOf = (r: BackupRow) => r.data as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const artistsOf = new Map<string, string[]>();
  for (const r of rows) if (/^users\/[^/]+$/.test(r.path)) artistsOf.set(r.path.split("/")[1], artistIdsOf(dataOf(r)));
  const single = (uid?: string) => { const as = uid ? artistsOf.get(uid) : undefined; return as?.length === 1 ? as[0] : undefined; };
  const memo = new Map<string, string | null | "busy">();
  const resolve = (path: string): string | null => {
    const m = memo.get(path);
    if (m === "busy") return null;
    if (m !== undefined) return m;
    const r = byPath.get(path);
    const parts = path.split("/");
    if (!r || ownerOf(kindOf(parts.slice(0, -1).join("/"))) !== "artist") return null;
    memo.set(path, "busy");
    const d = dataOf(r), kind = kindOf(parts.slice(0, -1).join("/")), id = parts[parts.length - 1];
    const parents: string[] = [];
    if (parts.length >= 4) parents.push(parts.slice(0, -2).join("/"));
    if (PARENTS[kind]?.keyedById) for (const k of PARENTS[kind].kinds) parents.push(`${k}/${id}`);
    for (const [f, k] of Object.entries(REF_FIELDS)) if (str(d[f]) && k !== kind) parents.push(`${k}/${d[f]}`);
    const out = str(d.artistId) ?? parents.map(resolve).find((x): x is string => !!x) ?? single(str(d.ownerUid)) ?? single(str(d.createdBy)) ?? artistId;
    memo.set(path, out);
    return out;
  };
  let changed = 0;
  for (const r of rows) {
    const parts = r.path.split("/");
    const d = dataOf(r);
    const kind = kindOf(parts.slice(0, -1).join("/"));
    if (kind === "history") {
      if (d.artistId !== undefined || d.ownerUid || d.shared) continue;
      const rec = parts.slice(0, -2).join("/"), recKind = kindOf(parts.slice(0, -3).join("/"));
      const owner = ownerOf(recKind);
      r.data = owner === "user" ? { ...d, artistId: null, ownerUid: parts[parts.length - 3] }
        : owner === "shared" ? { ...d, artistId: null, shared: true }
        : owner === "artist-self" ? { ...d, artistId: parts[parts.length - 3] }
        : { ...d, artistId: resolve(rec) ?? artistId };
      changed++;
      continue;
    }
    if (kind === "users" && parts.length === 2) {
      const mid = str(d.musicianId);
      const ms = (Array.isArray(d.artists) ? d.artists : []) as Membership[];
      const home = mid ? resolve(`musicians/${mid}`) : null;
      const artists = ms.map((m) => (mid && !m.musicianId && m.artistId === home ? { ...m, musicianId: mid } : m));
      const next = { ...d, artists, artistIds: artistIdsOf({ artists }) };
      if (JSON.stringify(next) !== JSON.stringify(d)) { r.data = next; changed++; }
      continue;
    }
    if (ownerOf(kind) !== "artist" || str(d.artistId)) continue;
    r.data = { ...d, artistId: resolve(r.path) ?? artistId };
    changed++;
  }
  return changed;
}

/**
 * Move an older backup's `users.musicianId` (the single musician link, removed in tenancy phase 7) onto the person's membership in
 * that musician's artist, in memory, and drop the field, so backups from before phase 7 still restore and validate. The membership
 * keeps a musician it already names. A musician that can't be placed (gone from the backup, or in an artist the person isn't in) is
 * only dropped when the person has exactly one membership, which then takes it. Returns how many users rows changed.
 */
export function musicianDump(dump: Dump): number {
  const artistOfMusician = new Map<string, string>();
  for (const r of Object.values(dump).flat()) {
    const m = /^(?:artists\/[^/]+\/)?musicians\/([^/]+)$/.exec(r.path);
    const a = (r.data as Record<string, unknown>).artistId;
    if (m && typeof a === "string") artistOfMusician.set(m[1], a);
  }
  let changed = 0;
  for (const r of dump.users ?? []) {
    if (!/^users\/[^/]+$/.test(r.path)) continue;
    const d = r.data as Record<string, unknown>;
    if (!("musicianId" in d)) continue;
    const { musicianId: mid, ...rest } = d;
    const ms = (Array.isArray(d.artists) ? d.artists : []) as Membership[];
    const home = typeof mid === "string" && mid ? artistOfMusician.get(mid) ?? (ms.length === 1 ? ms[0].artistId : undefined) : undefined;
    const artists = ms.map((m) => (home && m.artistId === home && !m.musicianId ? { ...m, musicianId: mid as string } : m));
    r.data = { ...rest, artists };
    changed++;
  }
  return changed;
}

/**
 * Give an older backup's artists the time zone they had in practice (tenancy phase 8 made `artists.timeZone` required): one
 * without a zone gets DEFAULT_TIME_ZONE (America/Denver). Returns how many changed. Run before validateDump, like stampDump.
 */
export function zoneDump(dump: Dump): number {
  let changed = 0;
  for (const r of dump.artists ?? []) {
    const d = r.data as Record<string, unknown>;
    if (!/^artists\/[^/]+$/.test(r.path) || (typeof d.timeZone === "string" && d.timeZone)) continue;
    r.data = { ...d, timeZone: DEFAULT_TIME_ZONE };
    changed++;
  }
  return changed;
}

export async function restoreDump(fs: Firestore, dump: Dump): Promise<number> {
  let n = 0, batch = fs.batch(), pending = 0;
  for (const row of Object.values(dump).flat()) {
    batch.set(fs.doc(row.path), decode(row.data) as Record<string, unknown>);
    n++;
    if (++pending === 400) { await batch.commit(); batch = fs.batch(); pending = 0; }
  }
  if (pending) await batch.commit();
  return n;
}
