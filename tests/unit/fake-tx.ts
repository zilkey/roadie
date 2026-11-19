/**
 * A fake Firestore transaction for Writer unit tests (no emulator). Tests name documents by their logical path (`shows/s1`,
 * `pitches/p1/comments/c1`); the fake stores them where the current layout puts them (tenancy phase 10: `artists/{a}/shows/s1` when
 * nested), and `logical()` maps what was written back. Queries (collection or collection group) answer equality filters on the
 * stored docs, which is what the Writer's dedupe, scoping and nested lookups send.
 */
import { DocumentReference, type DocumentData, type Transaction } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { physicalPath, splitPath } from "@/schema/owners";

/** Where a logical doc path is stored: under its record's artistId (the seed's, else the doc's own) when nested. */
export function storedAt(path: string, seed: Record<string, DocumentData>): string {
  const s = path.split("/");
  const top = `${s[0]}/${s[1]}`;
  const artistId = (seed[top]?.artistId ?? seed[path]?.artistId) as string | undefined;
  try { return `${physicalPath(s.slice(0, -1).join("/"), artistId)}/${s[s.length - 1]}`; } catch { return path; }
}
/** A map keyed by stored paths, keyed by logical paths instead. */
export const logical = <T>(m: Map<string, T>) => new Map([...m].map(([k, v]) => [splitPath(k).logical, v]));

const field = (d: DocumentData, f: string) => f.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), d);

export function fakeTx(seed: Record<string, DocumentData> = {}, opts: { clone?: boolean } = {}) {
  const store = new Map<string, DocumentData>(Object.entries(seed).map(([k, v]) => [storedAt(k, seed), opts.clone ? structuredClone(v) : v]));
  const writes = new Map<string, DocumentData>();
  const tx = {
    async get(ref: unknown) {
      if (ref instanceof DocumentReference) {
        const d = store.get(ref.path);
        return { exists: !!d, data: () => d };
      }
      const o = (ref as { _queryOptions: { collectionId: string; allDescendants: boolean; parentPath: { relativeName: string }; filters: { field: { formattedName: string }; op: string; value: unknown }[]; limit?: number } })._queryOptions;
      const parent = o.parentPath.relativeName ? `${o.parentPath.relativeName}/${o.collectionId}` : o.collectionId;
      const docs = [...store].filter(([p, d]) => {
        const col = p.split("/").slice(0, -1);
        if (o.allDescendants ? col[col.length - 1] !== o.collectionId : col.join("/") !== parent) return false;
        return o.filters.every((f) => (f.op === "EQUAL" ? JSON.stringify(field(d, f.field.formattedName)) === JSON.stringify(f.value) : f.op === "ARRAY_CONTAINS" ? (field(d, f.field.formattedName) as unknown[] | undefined)?.includes(f.value) : true));
      }).slice(0, o.limit ?? Infinity).map(([p, d]) => ({ id: p.split("/").pop()!, ref: firestore().doc(p), data: () => d }));
      return { docs, size: docs.length, empty: !docs.length };
    },
    set(ref: DocumentReference, data: DocumentData) { writes.set(ref.path, data); store.set(ref.path, data); },
    delete(ref: DocumentReference) { writes.delete(ref.path); store.delete(ref.path); },
  };
  return { tx: tx as unknown as Transaction, writes, store };
}
