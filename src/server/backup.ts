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

/** Every document in every collection, sub-collections included (and documents that exist only as parents of them are skipped). */
export async function dumpAll(fs: Firestore): Promise<Dump> {
  const dump: Dump = {};
  async function walk(col: FirebaseFirestore.CollectionReference, top: string) {
    const refs = await col.listDocuments();
    for (const ref of refs) {
      const snap = await ref.get();
      if (snap.exists) (dump[top] ??= []).push({ path: ref.path, data: encode(snap.data()) as Record<string, unknown> });
      for (const sub of await ref.listCollections()) await walk(sub, top);
    }
  }
  for (const col of await fs.listCollections()) {
    if (col.id === "mutations") continue; // idempotency bookkeeping, expires on its own
    if (col.id === "unsubmittedDrafts") continue; // personal scratch, expires on its own
    dump[col.id] ??= [];
    await walk(col, col.id);
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
