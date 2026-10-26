/**
 * Backup and restore of the whole database as JSON. Used by scripts/backup.ts and scripts/restore.ts.
 * One file per top-level collection; sub-collection documents (pitches/{id}/activity ...) are in their parent's file,
 * each row carrying its full `path`. Firestore timestamps are written as {"__ts": {seconds, nanoseconds}}.
 *
 * Restore is the one deliberate exception to "one door for writes": it writes documents exactly as they were
 * (ids, timestamps, runIds, history) so it does not go through db.ts, but every document is validated first.
 */
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { collections, commonShape, computedFields, kindOf } from "@/schema";

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

/** Check a decoded document against the collection's Zod schema. Returns error messages (empty = valid). */
export function validateRow(row: BackupRow): string[] {
  const parts = row.path.split("/");
  if (parts.length % 2 !== 0) return [`${row.path}: not a document path`];
  const kind = kindOf(parts.slice(0, -1).join("/"));
  if (ARCHIVED_COLLECTIONS.has(parts[0])) return [];
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
