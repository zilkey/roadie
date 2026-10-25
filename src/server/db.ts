/**
 * The ONLY write path. Every write goes through run()/create/update/softDelete/restore/merge:
 * validates with the collection's Zod schema, stamps common fields, writes a history entry (only the changed fields,
 * with the runId) at `{docPath}/history/{rev}` in the same transaction, enforces matchKey dedupe, and runs
 * denormalization hooks. One call to run() is one Firestore transaction (reads first, buffered writes applied at the end).
 */
import { Timestamp, type DocumentData, type Query, type Transaction } from "firebase-admin/firestore";
import { firestore } from "./admin";
import { AppError, invalid } from "./errors";
import type { Ctx } from "./ctx";
import type { FieldDiff } from "@/schema/history";
import { SCHEMA_VERSION, commonKeys, collections, computedFields, kindOf, normalizeDoc } from "@/schema";
import { denormalizers } from "./denorm";
import { diffHasPrivateContent } from "@/lib/venues";

export type Doc = DocumentData & { id: string };

const COMMON = new Set<string>(commonKeys);
/** Autosave patches fold into the previous history entry when it is at most this old. */
export const COALESCE_MS = 2 * 60_000;
const STAMP = new Set(["id", "schemaVersion", "createdAt", "updatedAt", "createdBy", "updatedBy", "via", "runId", "rev"]);

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

export type Diff = Record<string, FieldDiff>;
type Plain = { before: unknown; after: unknown };
type ListDiff = Extract<FieldDiff, { byId: unknown }>;
export const isListDiff = (d: FieldDiff): d is ListDiff => "byId" in d;

/** History entries are named by the zero-padded rev of the change, so they sort by id and never collide. */
export const revId = (rev: number) => String(rev).padStart(6, "0");
/** Path of the history subcollection under a document. */
export const historyPath = (path: string, id: string) => `${path}/${id}/history`;

/** itemId -> item, when `v` is an array of plain objects that all carry a unique string `id`. Otherwise null (diff the whole field). */
export function itemsById(v: unknown): Map<string, Record<string, unknown>> | null {
  if (!Array.isArray(v)) return null;
  const m = new Map<string, Record<string, unknown>>();
  for (const x of v) {
    if (!isPlain(x) || typeof x.id !== "string" || m.has(x.id)) return null;
    m.set(x.id, x);
  }
  return m;
}

function diffField(b: unknown, a: unknown): FieldDiff {
  const bm = itemsById(b), am = itemsById(a);
  if (!bm || !am || (!bm.size && !am.size)) return { before: b ?? null, after: a ?? null };
  const byId: ListDiff["byId"] = {};
  let i = 0;
  for (const [k, v] of bm) {
    const n = am.get(k);
    if (!n) byId[k] = { before: v, after: null, at: i };
    else if (!same(v, n)) byId[k] = { before: v, after: n };
    i++;
  }
  for (const [k, n] of am) if (!bm.has(k)) byId[k] = { before: null, after: n };
  const bo = [...bm.keys()], ao = [...am.keys()];
  const moved = JSON.stringify(bo.filter((k) => am.has(k))) !== JSON.stringify(ao.filter((k) => bm.has(k)));
  return { byId, ...(moved ? { order: { before: bo, after: ao } } : {}) };
}

export function diffDocs(before: DocumentData | null, after: DocumentData | null): Diff {
  const d: Diff = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (STAMP.has(k)) continue;
    const b = before?.[k], a = after?.[k];
    if (!same(b, a)) d[k] = diffField(b, a);
  }
  return d;
}

/**
 * Fold a newer diff of one field into an older one: keeps the first `before`, takes the last `after`.
 * null = ends where it started (drop the field); undefined = shapes that cannot be folded.
 */
function foldField(o: FieldDiff, n: FieldDiff): FieldDiff | null | undefined {
  if (!isListDiff(o) && !isListDiff(n)) return same(o.before, (n as Plain).after) ? null : { before: o.before, after: (n as Plain).after };
  if (!isListDiff(o) || !isListDiff(n) || o.order || n.order) return undefined;
  const byId = { ...o.byId };
  for (const [id, c] of Object.entries(n.byId)) {
    const p = byId[id];
    if (!p) { byId[id] = c; continue; }
    if (same(p.before, c.after)) delete byId[id];
    else {
      const at = p.at ?? c.at;
      byId[id] = { before: p.before, after: c.after, ...(c.after === null && at !== undefined ? { at } : {}) };
    }
  }
  return Object.keys(byId).length ? { byId } : null;
}

/** Undo one field's list diff against the list as it is now. Items edited again since are left alone and named in `skipped` ("field.itemId"). */
function revertList(field: string, current: unknown, d: ListDiff): { next: Record<string, unknown>[]; skipped: string[] } | null {
  const cm = itemsById(current);
  if (!cm) return null;
  const items = [...cm.values()];
  const skipped: string[] = [];
  for (const [iid, c] of Object.entries(d.byId)) {
    const idx = items.findIndex((x) => x.id === iid);
    if (!same(idx >= 0 ? items[idx] : null, c.after)) { skipped.push(`${field}.${iid}`); continue; }
    if (c.before === null || c.before === undefined) { if (idx >= 0) items.splice(idx, 1); }
    else if (idx >= 0) items[idx] = c.before as Record<string, unknown>;
    else items.splice(Math.min(c.at ?? items.length, items.length), 0, c.before as Record<string, unknown>);
  }
  if (d.order) {
    const have = new Set(items.map((x) => x.id as string)), after = d.order.after;
    const now = items.map((x) => x.id as string).filter((k) => after.includes(k));
    if (JSON.stringify(now) !== JSON.stringify(after.filter((k) => have.has(k)))) skipped.push(`${field}.order`);
    else {
      const rank = new Map(d.order.before.map((k, i) => [k, i]));
      items.sort((x, y) => (rank.get(x.id as string) ?? Infinity) - (rank.get(y.id as string) ?? Infinity));
    }
  }
  return { next: items, skipped };
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
  private overlay: Map<string, DocumentData | null>;
  readonly now: Timestamp;
  private seq = 0;
  /** Set when an autosave update folded into an earlier history entry: the rest of this unit uses that entry's runId. */
  coalescedRunId?: string;
  /** True when nothing will be flushed: reads that must see this run's own writes consult the overlay as well. */
  private readonly dryRun: boolean;
  /**
   * A dry run's overlay is handed in and shared by every unit of the run (see `run`'s `overlay`), because a later unit
   * legitimately reads what an earlier one wrote -- the support-slot promoters read the venues the rows before them
   * created. Writes then never reach Firestore but are still visible to the rest of the walk.
   */
  constructor(private tx: Transaction, readonly ctx: Ctx, opts: { overlay?: Map<string, DocumentData | null>; dryRun?: boolean } = {}) {
    this.now = ctx.now ? Timestamp.fromDate(ctx.now) : Timestamp.now();
    this.overlay = opts.overlay ?? new Map();
    this.dryRun = !!opts.dryRun;
  }
  get runId() { return this.coalescedRunId ?? this.ctx.runId; }

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

  /**
   * Query a collection; soft-deleted docs are hidden unless includeDeleted. Overlay-updated docs are reconciled.
   *
   * `pending` (a dry run) also brings in documents the overlay holds that Firestore has never seen, so the walk sees
   * its own earlier creates. They cannot be filtered by the query's own constraints -- that would mean
   * reimplementing Firestore -- so they are returned to be narrowed by the caller, which is why this is off unless
   * asked for.
   */
  async query(path: string, build?: (q: Query) => Query, opts: { includeDeleted?: boolean; pending?: boolean } = {}): Promise<Doc[]> {
    const q = build ? build(this.fs.collection(path)) : this.fs.collection(path);
    const snap = await this.tx.get(q);
    const out = new Map<string, Doc>();
    for (const d of snap.docs) out.set(d.id, { ...d.data(), id: d.id } as Doc);
    for (const [key, v] of this.overlay) {
      if (key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/") && (opts.pending || out.has(key.slice(path.length + 1)))) {
        const id = key.slice(path.length + 1);
        if (v) out.set(id, { ...v, id } as Doc); else out.delete(id);
      }
    }
    return [...out.values()].filter((d) => opts.includeDeleted || !d.deletedAt);
  }

  private stampNew(id: string, body: Record<string, unknown>): DocumentData {
    return {
      ...body, id, schemaVersion: SCHEMA_VERSION, createdAt: this.now, updatedAt: this.now,
      createdBy: this.ctx.uid, updatedBy: this.ctx.uid, via: this.ctx.via, runId: this.runId, deletedAt: null, rev: 1,
    };
  }
  private stampUpdate(prev: DocumentData, body: Record<string, unknown>, deletedAt: Timestamp | null): DocumentData {
    return {
      ...body, id: prev.id, schemaVersion: prev.schemaVersion ?? SCHEMA_VERSION, createdAt: prev.createdAt, createdBy: prev.createdBy,
      updatedAt: this.now, updatedBy: this.ctx.uid, via: this.ctx.via, runId: this.runId, deletedAt, rev: ((prev.rev as number | undefined) ?? 0) + 1,
    };
  }

  private actor() {
    const c = this.ctx;
    return { uid: c.uid, via: c.via, ...(c.sessionId ? { sessionId: c.sessionId } : {}), ...(c.client ? { client: c.client } : {}) };
  }

  /**
   * The artist a record belongs to, stamped on its history entries (firestore.rules let only that artist's admins read them):
   * its own `artistId`; a show's deal and sub-collection docs (comments, activity) take their parent's; an artist is its own.
   * Records of no one artist (contacts, songs, shared venues...) get null.
   */
  private async artistIdFor(path: string, id: string, doc: DocumentData, diff?: Diff): Promise<string | null> {
    if (typeof doc.artistId === "string") return doc.artistId;
    const kind = kindOf(path);
    // A not-yet-migrated venue still holds one band's private fields: a change that moves them (migrate:venue-notes) is that band's history.
    if (kind === "venues" && diff && diffHasPrivateContent(diff)) return this.ctx.artistId ?? null;
    if (kind === "artists") return id;
    if (kind === "showDeals") return ((await this.get("shows", id))?.artistId as string | undefined) ?? null;
    const seg = path.split("/");
    if (seg.length >= 3) {
      const parentPath = seg.slice(0, -2).join("/"), parentId = seg[seg.length - 2];
      const parent = await this.get(parentPath, parentId);
      return parent ? this.artistIdFor(parentPath, parentId, parent) : null;
    }
    return null;
  }

  private async commit(path: string, id: string, doc: DocumentData, op: "create" | "update" | "delete" | "merge" | "restore", diff: Diff, autosave = false) {
    const artistId = await this.artistIdFor(path, id, doc, diff);
    const ref = this.fs.collection(path).doc(id);
    const hist = ref.collection("history").doc(revId(doc.rev as number));
    const seq = this.seq++;
    this.overlay.set(`${path}/${id}`, doc);
    (this.ctx.touched ??= {})[id] = doc.rev as number;
    this.pending.push((tx) => {
      tx.set(ref, doc);
      tx.set(hist, {
        id: hist.id, schemaVersion: SCHEMA_VERSION, createdAt: this.now, updatedAt: this.now,
        createdBy: this.ctx.uid, updatedBy: this.ctx.uid, via: this.ctx.via, runId: this.runId, deletedAt: null, rev: 1,
        entity: { kind: path, id }, op, artistId, diff, seq, actor: this.actor(), docRev: doc.rev,
        ...(autosave ? { autosave: true } : {}),
      });
    });
  }

  /** History entries of one document newer than `rev` (newest first): a range read on its own subcollection. */
  private async historyAfter(path: string, id: string, rev: number): Promise<Doc[]> {
    return this.query(historyPath(path, id), (q) => q.where("docRev", ">", rev).orderBy("docRev", "desc").limit(25));
  }

  /** Field-level conflict: refuse to overwrite a field someone changed after the `rev` the caller saw. */
  private async checkConflict(path: string, id: string, baseRev: number, fields: string[]) {
    const newer = await this.historyAfter(path, id, baseRev);
    const cur = await this.get(path, id);
    const hits: { field: string; value: unknown; by: string; byUid: string; rev: number }[] = [];
    for (const f of fields) {
      const h = newer.find((e) => (e.diff as Diff)[f]); // newest first
      if (!h) continue;
      const d = (h.diff as Diff)[f];
      hits.push({ field: f, value: isListDiff(d) ? cur?.[f] ?? null : d.after, by: h.actor.uid, byUid: h.actor.uid, rev: h.docRev });
    }
    if (!hits.length) return;
    for (const h of hits) h.by = ((await this.get("users", h.byUid))?.name as string | undefined) ?? "Someone";
    const shown = (v: unknown) => (v === null || v === undefined || v === "" ? "empty" : typeof v === "string" ? `"${v}"` : JSON.stringify(v));
    const list = Array.isArray(hits[0].value);
    throw new AppError("conflict", list ? `${hits[0].by} changed ${hits[0].field}` : `${hits[0].by} changed ${hits[0].field} to ${shown(hits[0].value)}`, 409, undefined, { conflicts: hits, currentRev: (cur?.rev as number | undefined) ?? 0 });
  }

  /**
   * Autosave coalescing. An update with ctx.autosave folds into the document's newest history entry, which is simply
   * `{docPath}/history/{current rev}` (one direct read), when that entry is (a) an autosave update by the same person
   * from the app, (b) at most COALESCE_MS old, and (c) already covers every field this patch changes.
   * The entry keeps its first `before`, takes the new `after`, keeps its runId (the doc and the response use that runId
   * too), so undo of that one run puts the field back to what it was before the burst of typing. The entry moves to the
   * new rev's id so it stays the newest. Edits to a field the entry doesn't cover start a new entry (a new decision,
   * its own runId, its own Undo).
   */
  private async foldTarget(path: string, existing: Doc, diff: Diff): Promise<{ last: Doc; merged: Diff } | null> {
    if (!this.ctx.autosave || this.ctx.via !== "app" || typeof existing.rev !== "number") return null;
    const last = await this.get(historyPath(path, existing.id), revId(existing.rev));
    if (!last || last.op !== "update" || !last.autosave || last.actor?.uid !== this.ctx.uid || last.entity?.kind !== path) return null;
    const at = (last.updatedAt as Timestamp | undefined)?.toMillis() ?? 0;
    if (this.now.toMillis() - at > COALESCE_MS) return null;
    if (!Object.keys(diff).every((k) => k in (last.diff as Diff))) return null;
    const merged: Diff = { ...(last.diff as Diff) };
    for (const [k, d] of Object.entries(diff)) {
      const m = foldField(merged[k], d);
      if (m === undefined) return null;
      if (m === null) delete merged[k]; else merged[k] = m;
    }
    return { last, merged };
  }

  private commitFolded(path: string, id: string, doc: DocumentData, into: { last: Doc; merged: Diff }) {
    const ref = this.fs.collection(path).doc(id);
    const old = ref.collection("history").doc(into.last.id);
    const hist = ref.collection("history").doc(revId(doc.rev as number));
    const { id: _oldId, ...body } = into.last;
    void _oldId;
    this.overlay.set(`${path}/${id}`, doc);
    (this.ctx.touched ??= {})[id] = doc.rev as number;
    this.pending.push((tx) => {
      tx.set(ref, doc);
      tx.delete(old);
      tx.set(hist, { ...body, id: hist.id, diff: into.merged, docRev: doc.rev, updatedAt: this.now, updatedBy: this.ctx.uid });
    });
  }

  /** Create. For dedupe collections a matching live doc is merged into instead (merged: true). */
  async create(path: string, input: Record<string, unknown>, opts: { id?: string; keep?: { createdAt: Timestamp; createdBy: string } } = {}): Promise<{ id: string; merged: boolean }> {
    const kind = kindOf(path);
    const d = def(kind);
    const { data, computed } = prepare(kind, input);
    if (d.dedupe && computed.matchKey) {
      // On a dry run the records earlier rows "created" are only in the overlay, so the matchKey query would miss
      // them and every near-duplicate would be reported as a clean create -- the one thing a survey must not hide.
      const hits = (await this.query(path, (q) => q.where("matchKey", "==", computed.matchKey).limit(5), { pending: this.dryRun }))
        .filter((h) => !this.dryRun || h.matchKey === computed.matchKey);
      if (hits[0]) return this.mergeInto(path, hits[0], data);
    }
    const id = opts.id ?? this.fs.collection(path).doc().id;
    if (opts.id && (await this.get(path, id))) throw new AppError("already_exists", `${path}/${id} already exists`, 409);
    const doc = clean(this.stampNew(id, { ...data, ...computed }));
    // A copy of an older record (comments carried from a pitch to its show) keeps the original's creation time and creator.
    if (opts.keep) Object.assign(doc, opts.keep);
    await this.commit(path, id, doc, "create", diffDocs(null, doc));
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
      await this.commit(path, existing.id, next, "merge", diff);
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
    let next = clean(this.stampUpdate(existing, { ...data, ...computed }, null));
    const diff = diffDocs(existing, next);
    if (!Object.keys(diff).length) return { id, changed: false };
    const br = this.ctx.baseRev;
    if (br?.id === id) await this.checkConflict(path, id, br.rev, Object.keys(diff));
    const fold = await this.foldTarget(path, existing, diff);
    if (fold) {
      this.coalescedRunId = fold.last.runId as string;
      next = { ...next, runId: this.coalescedRunId };
      this.commitFolded(path, id, next, fold);
    } else await this.commit(path, id, next, "update", diff, !!this.ctx.autosave && this.ctx.via === "app");
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
    await this.commit(path, id, next, "delete", diffDocs(existing, next));
    return { id, changed: true };
  }

  async restore(path: string, id: string) {
    const existing = await this.get(path, id);
    if (!existing) throw new AppError("not_found", `${path}/${id} not found`, 404);
    if (!existing.deletedAt) return { id, changed: false };
    const next = clean(this.stampUpdate(existing, writable(existing), null));
    await this.commit(path, id, next, "restore", diffDocs(existing, next));
    return { id, changed: true };
  }

  /**
   * Reverse one history entry (used by undo only). create -> soft delete, delete -> restore, restore -> soft delete,
   * update/merge -> put the `before` values back. Works on append-only docs too (activity); never on immutable ones.
   */
  async revert(path: string, id: string, op: string, diff: Diff): Promise<{ changed: boolean; as: "delete" | "restore" | "update"; skipped?: string[] }> {
    const kind = kindOf(path);
    const d = def(kind);
    if (d.immutable) throw new AppError("immutable", `${kind} documents are never edited`, 409);
    const existing = await this.get(path, id);
    if (!existing) throw new AppError("not_found", `${path}/${id} not found`, 404);
    if (op === "create" || op === "restore") {
      if (existing.deletedAt) return { changed: false, as: "delete" };
      const next = clean(this.stampUpdate(existing, writable(existing), this.now));
      await this.commit(path, id, next, "delete", diffDocs(existing, next));
      await this.afterChange(path, existing, next);
      return { changed: true, as: "delete" };
    }
    if (op === "delete") {
      if (!existing.deletedAt) return { changed: false, as: "restore" };
      const next = clean(this.stampUpdate(existing, writable(existing), null));
      await this.commit(path, id, next, "restore", diffDocs(existing, next));
      await this.afterChange(path, existing, next);
      return { changed: true, as: "restore" };
    }
    const computed = new Set(computedFields[kind] ?? []);
    const merged: Record<string, unknown> = { ...writable(existing) };
    const skipped: string[] = [];
    for (const [k, v] of Object.entries(diff)) {
      if (COMMON.has(k) || computed.has(k)) continue;
      if (isListDiff(v)) {
        const r = revertList(k, existing[k], v);
        if (!r) { skipped.push(k); continue; } // no longer a list of id-keyed items: leave it alone
        skipped.push(...r.skipped);
        merged[k] = r.next;
        continue;
      }
      if (!same(existing[k], v.after)) { skipped.push(k); continue; } // changed again since: leave the newer value alone
      if (v.before === null || v.before === undefined) delete merged[k]; else merged[k] = v.before;
    }
    const { data, computed: comp } = prepare(kind, merged);
    const next = clean(this.stampUpdate(existing, { ...data, ...comp }, existing.deletedAt ?? null));
    const changes = diffDocs(existing, next);
    if (!Object.keys(changes).length) return { changed: false, as: "update", ...(skipped.length ? { skipped } : {}) };
    await this.commit(path, id, next, "update", changes);
    await this.afterChange(path, existing, next);
    return { changed: true, as: "update", ...(skipped.length ? { skipped } : {}) };
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

/**
 * One transaction. Retries re-run fn, so keep it free of side effects other than writer calls.
 *
 * `dryRun` skips the flush, which is the only thing that puts a write on the transaction: every `create`/`update`
 * still records itself in the Writer's overlay, so reads later in the same unit see it and a walk over the data
 * behaves exactly as the real run would (dedupe merges, cross-references, "already there" counts) while Firestore is
 * only ever read. Used by the importers' surveys -- see scripts/survey.ts.
 *
 * Pass the same `overlay` map to every unit of one dry run so later units see what earlier ones wrote. Without it
 * each transaction starts blank and an import that reads back its own earlier records sees nothing there.
 */
export async function run<T>(
  ctx: Ctx,
  fn: (w: Writer) => Promise<T>,
  opts: { dryRun?: boolean; overlay?: Map<string, DocumentData | null> } = {},
): Promise<T> {
  let last: Writer | undefined;
  const out = await firestore().runTransaction(async (tx) => {
    const w = (last = new Writer(tx, ctx, { overlay: opts.overlay, dryRun: opts.dryRun }));
    const out = await fn(w);
    if (!opts.dryRun) w.flush();
    return out;
  });
  if (last?.coalescedRunId) ctx.runId = last.coalescedRunId; // the caller (and the response) now refer to the entry that was folded into
  return out;
}

/**
 * The one write outside history: `mcpTokens.lastUsedAt` is telemetry, not business data, so it is stamped directly
 * (no history entry, so undoing an AI run never blanks it) and at most once a minute per token.
 */
export async function touchLastUsed(hash: string, now = new Date()): Promise<void> {
  const ref = firestore().collection("mcpTokens").doc(hash);
  const snap = await ref.get();
  const last = snap.data()?.lastUsedAt as Timestamp | undefined;
  if (last && now.getTime() - last.toMillis() < 60_000) return;
  await ref.update({ lastUsedAt: Timestamp.fromDate(now) });
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
  async list(path: string, build?: (q: Query) => Query, opts: { includeDeleted?: boolean } = {}): Promise<Doc[]> {
    const s = await (build ? build(firestore().collection(path)) : firestore().collection(path)).get();
    return s.docs.map((d) => ({ ...d.data(), id: d.id }) as Doc).filter((d) => opts.includeDeleted || !d.deletedAt);
  },
  /** Collection-group query (every collection with this name, at any depth). Rows carry their full `path`. */
  async listGroup(group: string, build?: (q: Query) => Query): Promise<(Doc & { path: string })[]> {
    const g = firestore().collectionGroup(group);
    const s = await (build ? build(g) : g).get();
    return s.docs.map((d) => ({ ...d.data(), id: d.id, path: d.ref.path }) as Doc & { path: string }).filter((d) => !d.deletedAt);
  },
  /** History entries of one record, newest first (a direct read of its subcollection). */
  async history(path: string, id: string, limit = 50): Promise<Doc[]> {
    return db.list(historyPath(path, id), (q) => q.orderBy("docRev", "desc").limit(limit));
  },
};
