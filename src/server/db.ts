/**
 * The ONLY write path. Every write goes through run()/create/update/softDelete/restore/merge:
 * validates with the collection's Zod schema, stamps common fields, writes a `history` doc with a
 * diff + runId, enforces matchKey dedupe, and runs denormalization hooks. One call to run() is one
 * Firestore transaction (reads first, buffered writes applied at the end).
 */
import { Timestamp, type DocumentData, type Query, type Transaction } from "firebase-admin/firestore";
import { firestore } from "./admin";
import { AppError, invalid } from "./errors";
import type { Ctx } from "./ctx";
import { SCHEMA_VERSION, commonKeys, collections, computedFields, kindOf, normalizeDoc } from "@/schema";
import { denormalizers } from "./denorm";

export type Doc = DocumentData & { id: string };

const COMMON = new Set<string>(commonKeys);
const STAMP = new Set(["id", "schemaVersion", "createdAt", "updatedAt", "createdBy", "updatedBy", "via", "runId"]);

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const isTs = (v: unknown) => v instanceof Timestamp || v instanceof Date;

/** Deep-removes undefined so Firestore accepts the doc. */
export function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as T;
  if (isPlain(v)) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = clean(x);
    return o as T;
  }
  return v;
}
const same = (a: unknown, b: unknown) => {
  const norm = (x: unknown): unknown =>
    isTs(x) ? (x as Timestamp).toMillis?.() ?? (x as Date).getTime() : Array.isArray(x) ? x.map(norm)
      : isPlain(x) ? Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined).sort(([p], [q]) => (p < q ? -1 : 1)).map(([k, y]) => [k, norm(y)]))
      : x === undefined ? null : x;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
};

export type Diff = Record<string, { before: unknown; after: unknown }>;
export function diffDocs(before: DocumentData | null, after: DocumentData | null): Diff {
  const d: Diff = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (STAMP.has(k)) continue;
    const b = before?.[k], a = after?.[k];
    if (!same(b, a)) d[k] = { before: b ?? null, after: a ?? null };
  }
  return d;
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Fill gaps in `existing` from `incoming`; arrays are unioned. Existing non-empty values win. */
export function mergeFill(existing: unknown, incoming: unknown): unknown {
  if (isEmpty(existing)) return incoming;
  if (isEmpty(incoming)) return existing;
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    const seen = new Set(existing.map((x) => JSON.stringify(x)));
    return [...existing, ...incoming.filter((x) => !seen.has(JSON.stringify(x)))];
  }
  if (isPlain(existing) && isPlain(incoming)) {
    const o: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(incoming)) o[k] = mergeFill(existing[k], v);
    return o;
  }
  return existing;
}

function def(kind: string) {
  const d = collections[kind];
  if (!d) throw new AppError("unknown_collection", `Unknown collection ${kind}`, 500);
  return d;
}

/** Normalize + validate writable fields; returns validated data plus computed fields. */
function prepare(kind: string, raw: Record<string, unknown>) {
  const norm = normalizeDoc(kind, raw);
  const computed: Record<string, unknown> = {};
  for (const k of computedFields[kind] ?? []) {
    computed[k] = norm[k];
    delete norm[k];
  }
  const res = def(kind).input.safeParse(norm);
  if (!res.success) throw invalid(res.error);
  return { data: clean(res.data as Record<string, unknown>), computed: clean(computed) };
}

function writable(doc: DocumentData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!COMMON.has(k)) o[k] = v;
  return o;
}

export class Writer {
  private pending: ((tx: Transaction) => void)[] = [];
  private overlay = new Map<string, DocumentData | null>();
  readonly now = Timestamp.now();
  constructor(private tx: Transaction, readonly ctx: Ctx) {}

  private fs = firestore();
  flush() { for (const p of this.pending) p(this.tx); }

  /** Read one doc (including soft-deleted). Sees this unit's own pending writes. */
  async get(path: string, id: string): Promise<Doc | null> {
    const key = `${path}/${id}`;
    if (this.overlay.has(key)) {
      const v = this.overlay.get(key);
      return v ? ({ ...v, id } as Doc) : null;
    }
    const snap = await this.tx.get(this.fs.collection(path).doc(id));
    return snap.exists ? ({ ...snap.data()!, id } as Doc) : null;
  }

  /** Query a collection; soft-deleted docs are hidden unless includeDeleted. Overlay-updated docs are reconciled. */
  async query(path: string, build?: (q: Query) => Query, opts: { includeDeleted?: boolean } = {}): Promise<Doc[]> {
    const q = build ? build(this.fs.collection(path)) : this.fs.collection(path);
    const snap = await this.tx.get(q);
    const out = new Map<string, Doc>();
    for (const d of snap.docs) out.set(d.id, { ...d.data(), id: d.id } as Doc);
    for (const [key, v] of this.overlay) {
      if (key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/") && out.has(key.slice(path.length + 1))) {
        const id = key.slice(path.length + 1);
        if (v) out.set(id, { ...v, id } as Doc); else out.delete(id);
      }
    }
    return [...out.values()].filter((d) => opts.includeDeleted || !d.deletedAt);
  }

  private stampNew(id: string, body: Record<string, unknown>): DocumentData {
    return {
      ...body, id, schemaVersion: SCHEMA_VERSION, createdAt: this.now, updatedAt: this.now,
      createdBy: this.ctx.uid, updatedBy: this.ctx.uid, via: this.ctx.via, runId: this.ctx.runId, deletedAt: null,
    };
  }
  private stampUpdate(prev: DocumentData, body: Record<string, unknown>, deletedAt: Timestamp | null): DocumentData {
    return {
      ...body, id: prev.id, schemaVersion: prev.schemaVersion ?? SCHEMA_VERSION, createdAt: prev.createdAt, createdBy: prev.createdBy,
      updatedAt: this.now, updatedBy: this.ctx.uid, via: this.ctx.via, runId: this.ctx.runId, deletedAt,
    };
  }

  private commit(path: string, id: string, doc: DocumentData, op: "create" | "update" | "delete" | "merge" | "restore", diff: Diff) {
    const ref = this.fs.collection(path).doc(id);
    const hist = this.fs.collection("history").doc();
    this.overlay.set(`${path}/${id}`, doc);
    this.pending.push((tx) => {
      tx.set(ref, doc);
      tx.set(hist, {
        id: hist.id, schemaVersion: SCHEMA_VERSION, createdAt: this.now, updatedAt: this.now,
        createdBy: this.ctx.uid, updatedBy: this.ctx.uid, via: this.ctx.via, runId: this.ctx.runId, deletedAt: null,
        entity: { kind: path, id }, op, diff, actor: { uid: this.ctx.uid, via: this.ctx.via },
      });
    });
  }

  /** Create. For dedupe collections a matching live doc is merged into instead (merged: true). */
  async create(path: string, input: Record<string, unknown>, opts: { id?: string } = {}): Promise<{ id: string; merged: boolean }> {
    const kind = kindOf(path);
    const d = def(kind);
    const { data, computed } = prepare(kind, input);
    if (d.dedupe && computed.matchKey) {
      const hits = await this.query(path, (q) => q.where("matchKey", "==", computed.matchKey).limit(5));
      if (hits[0]) return this.mergeInto(path, hits[0], data);
    }
    const id = opts.id ?? this.fs.collection(path).doc().id;
    if (opts.id && (await this.get(path, id))) throw new AppError("already_exists", `${path}/${id} already exists`, 409);
    const doc = clean(this.stampNew(id, { ...data, ...computed }));
    this.commit(path, id, doc, "create", diffDocs(null, doc));
    return { id, merged: false };
  }

  private async mergeInto(path: string, existing: Doc, incoming: Record<string, unknown>) {
    const kind = kindOf(path);
    const base = writable(existing);
    const filled: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(incoming)) filled[k] = mergeFill(base[k], v);
    const { data, computed } = prepare(kind, filled);
    const next = clean(this.stampUpdate(existing, { ...data, ...computed }, existing.deletedAt ?? null));
    const diff = diffDocs(existing, next);
    if (Object.keys(diff).length) {
      this.commit(path, existing.id, next, "merge", diff);
      await this.afterChange(path, existing, next);
    }
    return { id: existing.id, merged: true };
  }

  /** Explicit merge of input into an existing doc (fill gaps, union arrays). */
  async merge(path: string, id: string, input: Record<string, unknown>) {
    const dm = def(kindOf(path));
    if (dm.immutable || dm.appendOnly) throw new AppError("immutable", `${kindOf(path)} documents are never edited`, 409);
    const existing = await this.get(path, id);
    if (!existing || existing.deletedAt) throw new AppError("not_found", `${path}/${id} not found`, 404);
    return this.mergeInto(path, existing, input);
  }

  /** Patch top-level fields. null removes an optional field. */
  async update(path: string, id: string, patch: Record<string, unknown>) {
    const kind = kindOf(path);
    const d = def(kind);
    if (d.immutable || d.appendOnly) throw new AppError("immutable", `${kind} documents are never edited`, 409);
    const existing = await this.get(path, id);
    if (!existing || existing.deletedAt) throw new AppError("not_found", `${path}/${id} not found`, 404);
    const bad = Object.keys(patch).filter((k) => COMMON.has(k) || (computedFields[kind] ?? []).includes(k));
    if (bad.length) throw new AppError("invalid_input", `Cannot set server fields: ${bad.join(", ")}`, 400);
    const merged: Record<string, unknown> = { ...writable(existing) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete merged[k]; else merged[k] = v;
    }
    const { data, computed } = prepare(kind, merged);
    if (d.dedupe && computed.matchKey && computed.matchKey !== existing.matchKey) {
      const hits = await this.query(path, (q) => q.where("matchKey", "==", computed.matchKey).limit(5));
      if (hits.some((h) => h.id !== id)) throw new AppError("duplicate", `Another ${kind} already matches that name`, 409);
    }
    const next = clean(this.stampUpdate(existing, { ...data, ...computed }, null));
    const diff = diffDocs(existing, next);
    if (!Object.keys(diff).length) return { id, changed: false };
    this.commit(path, id, next, "update", diff);
    await this.afterChange(path, existing, next);
    return { id, changed: true };
  }

  async softDelete(path: string, id: string) {
    const kind = kindOf(path);
    if (def(kind).immutable || def(kind).appendOnly) throw new AppError("immutable", `${kind} documents are never deleted`, 409);
    const existing = await this.get(path, id);
    if (!existing) throw new AppError("not_found", `${path}/${id} not found`, 404);
    if (existing.deletedAt) return { id, changed: false };
    const next = clean(this.stampUpdate(existing, writable(existing), this.now));
    this.commit(path, id, next, "delete", diffDocs(existing, next));
    return { id, changed: true };
  }

  async restore(path: string, id: string) {
    const existing = await this.get(path, id);
    if (!existing) throw new AppError("not_found", `${path}/${id} not found`, 404);
    if (!existing.deletedAt) return { id, changed: false };
    const next = clean(this.stampUpdate(existing, writable(existing), null));
    this.commit(path, id, next, "restore", diffDocs(existing, next));
    return { id, changed: true };
  }

  /** Denormalization hooks: refresh copies of display fields when the source doc changes. */
  private async afterChange(path: string, before: Doc, after: DocumentData) {
    const kind = kindOf(path);
    for (const h of denormalizers) {
      if (h.source !== kind) continue;
      if (h.watch.every((f) => same(before[f], after[f]))) continue;
      await h.refresh(this, before.id, after);
    }
  }
}

/** One transaction. Retries re-run fn, so keep it free of side effects other than writer calls. */
export async function run<T>(ctx: Ctx, fn: (w: Writer) => Promise<T>): Promise<T> {
  return firestore().runTransaction(async (tx) => {
    const w = new Writer(tx, ctx);
    const out = await fn(w);
    w.flush();
    return out;
  });
}

export const db = {
  run,
  create: (ctx: Ctx, path: string, input: Record<string, unknown>, opts?: { id?: string }) => run(ctx, (w) => w.create(path, input, opts)),
  update: (ctx: Ctx, path: string, id: string, patch: Record<string, unknown>) => run(ctx, (w) => w.update(path, id, patch)),
  merge: (ctx: Ctx, path: string, id: string, input: Record<string, unknown>) => run(ctx, (w) => w.merge(path, id, input)),
  softDelete: (ctx: Ctx, path: string, id: string) => run(ctx, (w) => w.softDelete(path, id)),
  restore: (ctx: Ctx, path: string, id: string) => run(ctx, (w) => w.restore(path, id)),
  /** Plain read (not part of a write unit). */
  async get(path: string, id: string): Promise<Doc | null> {
    const s = await firestore().collection(path).doc(id).get();
    return s.exists ? ({ ...s.data()!, id } as Doc) : null;
  },
  async list(path: string, build?: (q: Query) => Query): Promise<Doc[]> {
    const s = await (build ? build(firestore().collection(path)) : firestore().collection(path)).get();
    return s.docs.map((d) => ({ ...d.data(), id: d.id }) as Doc).filter((d) => !d.deletedAt);
  },
};
