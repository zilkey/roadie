/**
 * The ONLY write path. Every write goes through run()/create/update/softDelete/restore/merge:
 * validates with the collection's Zod schema, stamps common fields, writes a history entry (only the changed fields,
 * with the runId) at `{docPath}/history/{rev}` in the same transaction, enforces matchKey dedupe, and runs
 * denormalization hooks. One call to run() is one Firestore transaction (reads first, buffered writes applied at the end).
 */
import { Timestamp, type DocumentData, type DocumentReference, type DocumentSnapshot, type Query, type QuerySnapshot, type Transaction } from "firebase-admin/firestore";
import { firestore } from "./admin";
import { AppError, invalid } from "./errors";
import type { AnyCtx, ArtistCtx, Ctx } from "./ctx";
import type { FieldDiff } from "@/schema/history";
import { SCHEMA_VERSION, commonKeys, collections, computedFields, kindOf, normalizeDoc } from "@/schema";
import { denormalizers } from "./denorm";
import { SHARED_KINDS, accessOf, refusedMessage } from "./platform";
import { PARENTS, inLayout, movesPath, nestedPaths, ownerOf, physicalPath, splitPath } from "@/schema/owners";
import { layout, readOnlyError } from "./layout";
import { LINKED_KINDS, linkPath } from "./links";
import type { Membership } from "@/schema/users";

/**
 * Tenancy (plan D3): may `ctx` see this doc? With a SystemCtx (or inside `w.system()`) everything is visible. Otherwise an artist
 * kind is visible only when its `artistId` is the ctx's (a doc with none fails closed), the artist's own doc only when its id is the
 * ctx's artist, and a History entry only when it names no other artist. A PersonCtx sees no artist's records.
 */
export function visibleTo(ctx: AnyCtx, path: string, id: string, doc: DocumentData, system = false): boolean {
  if (system || ctx.system) return true;
  const owner = ownerOf(kindOf(path));
  if (owner === "artist") return !!ctx.artistId && doc.artistId === ctx.artistId;
  if (owner === "artist-self") return !!ctx.artistId && id === ctx.artistId;
  if (owner === "history") return doc.artistId === null || doc.artistId === undefined || doc.artistId === ctx.artistId;
  return true;
}
/** The scoped form of a query on `path` (a kind, a sub-collection path or a collection group): null when the ctx sees none of it. */
function scoped(ctx: AnyCtx, path: string, q: Query, system = false): Query | null {
  if (system || ctx.system) return q;
  const owner = ownerOf(kindOf(path));
  if (owner === "artist" || (owner === "history" && !path.includes("/"))) return ctx.artistId ? q.where("artistId", "==", ctx.artistId) : null;
  if (owner === "artist-self") return ctx.artistId ? q : null;
  return q;
}
const notFound = (path: string, id: string) => new AppError("not_found", `${path}/${id} not found`, 404);

/**
 * Where records live (tenancy phase 10). Code names a collection by its logical path (`shows`, `pitches/{id}/comments`,
 * `shows/{id}/history`); with nested paths an artist record is stored under `artists/{artistId}/…`. These helpers find that
 * artist: an ArtistCtx only ever reads its own artist's subtree (the path is its scope), and the system view finds a record by
 * what it already saw, a hint, its own artist, then a collection-group lookup on the record's `id` field.
 */
interface Reader { doc(ref: DocumentReference): Promise<DocumentSnapshot>; query(q: Query): Promise<QuerySnapshot> }
const plainReader: Reader = { doc: (r) => r.get(), query: (q) => q.get() };
const txReader = (tx: Transaction): Reader => ({ doc: (r) => tx.get(r), query: (q) => tx.get(q) });
/** "kind/id" of a top-level record → the artist it is stored under (nested layout). */
type Located = Map<string, string>;

/** Remember where every row of a nested collection-group or collection read lives. */
function remember(located: Located, docs: readonly { ref: DocumentReference }[]) {
  for (const d of docs) {
    const { logical, artistId } = splitPath(d.ref.path);
    if (!artistId) continue;
    const s = logical.split("/");
    located.set(`${s[0]}/${s[1]}`, artistId);
  }
}

async function artistDir(read: Reader, located: Located, ctx: AnyCtx, sys: boolean, kind: string, id: string, hint?: string): Promise<string | null> {
  const key = `${kind}/${id}`;
  const known = located.get(key);
  if (known) return known;
  if (hint) return hint;
  if (!sys) return ctx.artistId ?? null;
  const fs = firestore();
  if (ctx.artistId && (await read.doc(fs.doc(`artists/${ctx.artistId}/${kind}/${id}`))).exists) { located.set(key, ctx.artistId); return ctx.artistId; }
  const snap = await read.query(fs.collectionGroup(kind).where("id", "==", id).limit(10));
  const hit = snap.docs.find((d) => { const sp = splitPath(d.ref.parent.path); return !!sp.artistId && sp.logical === kind; });
  if (!hit) return null;
  const a = splitPath(hit.ref.path).artistId!;
  located.set(key, a);
  return a;
}

/** The stored collection path of logical collection `lp` holding doc `id` (any doc of it, for a sub-collection), or null when it can't be found. */
async function collectionAt(read: Reader, located: Located, ctx: AnyCtx, sys: boolean, lp: string, id: string | null, hint?: string): Promise<string | null> {
  if (!nestedPaths() || !movesPath(lp)) return lp;
  const s = lp.split("/");
  const a = s.length >= 3 ? await artistDir(read, located, ctx, sys, s[0], s[1], hint) : id ? await artistDir(read, located, ctx, sys, lp, id, hint) : (hint ?? (sys ? null : ctx.artistId ?? null));
  return a ? physicalPath(lp, a) : null;
}

/**
 * The query for a logical collection: its stored collection, or, for the system view of a nested top-level kind with no artist known,
 * a collection-group query (every artist's), whose rows `keep` narrows to that kind's own collections in the current layout.
 */
async function queryBase(read: Reader, located: Located, ctx: AnyCtx, sys: boolean, path: string): Promise<{ q: Query; lp: string; keep: (ref: DocumentReference) => boolean } | null> {
  const { logical: lp, artistId: named } = splitPath(path);
  const fs = firestore();
  const all = () => true;
  if (!nestedPaths() || !movesPath(lp)) return { q: fs.collection(lp), lp, keep: all };
  if (lp.includes("/") || named || !sys) {
    const at = await collectionAt(read, located, ctx, sys, lp, null, named);
    return at ? { q: fs.collection(at), lp, keep: all } : null;
  }
  return { q: fs.collectionGroup(lp), lp, keep: (ref) => inLayout(ref.path) && splitPath(ref.parent.path).logical === lp };
}

export type Doc = DocumentData & { id: string };

const COMMON = new Set<string>(commonKeys);
/** Autosave patches fold into the previous history entry when it is at most this old. */
export const COALESCE_MS = 2 * 60_000;
const STAMP = new Set(["id", "schemaVersion", "createdAt", "updatedAt", "createdBy", "updatedBy", "via", "runId", "rev", "adoptedAt"]);

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

/** One write unit's state, shared by the Writer and the artist-bound Writers it hands out (`forArtist`). */
interface Unit {
  pending: ((tx: Transaction) => void)[];
  /** What this unit has written so far, by document path (null = deleted): its reads see its own writes. */
  overlay: Map<string, DocumentData | null>;
  seq: number;
  /** Shared records ("path/id") an approved editor is changing for the first time since someone else created them: stamped adoptedAt. */
  adopting: Set<string>;
  /** Set when an autosave update folded into an earlier history entry: the rest of this unit uses that entry's runId. */
  coalescedRunId?: string;
  /** Nested layout: the artist each record this unit has seen is stored under ("kind/id" → artistId). */
  located: Located;
}

export class Writer<C extends AnyCtx = Ctx> {
  private unit: Unit;
  readonly now: Timestamp;
  /**
   * Above zero inside `system()` (denormalization hooks, act lookups): reads are unscoped and the shared-record check is skipped,
   * since these writes follow a change already allowed or fill in looked-up facts. Allow-listed (tests/unit/tenancy-guard.test.ts).
   */
  private sysDepth = 0;
  /** Above zero while denormalization hooks run: their history entries are `derived` (a copy of a change made elsewhere). */
  private deriving = 0;
  constructor(private tx: Transaction, readonly ctx: C, unit?: Unit) {
    this.now = ctx.now ? Timestamp.fromDate(ctx.now) : Timestamp.now();
    this.unit = unit ?? { pending: [], overlay: new Map(), seq: 0, adopting: new Set(), located: new Map() };
  }
  get coalescedRunId() { return this.unit.coalescedRunId; }
  get runId() { return this.unit.coalescedRunId ?? this.ctx.runId; }
  private get overlay() { return this.unit.overlay; }
  private get pending() { return this.unit.pending; }
  private get adopting() { return this.unit.adopting; }
  /** Reads are unscoped: a SystemCtx, or inside `system()`. */
  private get sys() { return this.ctx.system === true || this.sysDepth > 0; }

  private fs = firestore();
  /** Whether this unit has anything to write. */
  get hasWrites() { return this.pending.length > 0; }
  flush() { for (const p of this.pending) p(this.tx); }
  private get read() { return txReader(this.tx); }

  /** The stored reference of a record about to be written: an artist record is stored under its own `artistId` (nested layout). */
  private refFor(lp: string, id: string, doc: DocumentData): DocumentReference {
    const s = lp.split("/");
    const artistId = typeof doc.artistId === "string" && doc.artistId ? doc.artistId : this.unit.located.get(s.length >= 3 ? `${s[0]}/${s[1]}` : `${lp}/${id}`);
    if (artistId && nestedPaths() && movesPath(lp)) this.unit.located.set(s.length >= 3 ? `${s[0]}/${s[1]}` : `${lp}/${id}`, artistId);
    return this.fs.collection(physicalPath(lp, artistId)).doc(id);
  }

  /** Read one doc with no artist check (including soft-deleted). Sees this unit's own pending writes. Private: parent and stamping lookups. */
  private async rawGet(path: string, id: string): Promise<Doc | null> {
    const { logical: lp, artistId: named } = splitPath(path);
    const key = `${lp}/${id}`;
    if (this.overlay.has(key)) {
      const v = this.overlay.get(key);
      return v ? ({ ...v, id } as Doc) : null;
    }
    // Unscoped: a parent or stamping lookup may need another artist's record to refuse it, so it looks wherever the record is.
    const at = await collectionAt(this.read, this.unit.located, this.ctx, true, lp, id, named);
    if (!at) return null;
    const snap = await this.tx.get(this.fs.collection(at).doc(id));
    return snap.exists ? ({ ...snap.data()!, id } as Doc) : null;
  }

  /** Read one doc (including soft-deleted), scoped to the ctx's artist: another artist's record reads as null. Sees this unit's own pending writes. */
  async get(path: string, id: string): Promise<Doc | null> {
    const { logical: lp, artistId: named } = splitPath(path);
    const key = `${lp}/${id}`;
    if (!this.overlay.has(key) && !this.sys && nestedPaths() && movesPath(lp)) {
      // Nested: an artist only ever reads its own subtree; another artist's id simply isn't there.
      if (!this.ctx.artistId || (named && named !== this.ctx.artistId)) return null;
      const at = await collectionAt(this.read, this.unit.located, this.ctx, false, lp, id);
      const snap = at ? await this.tx.get(this.fs.collection(at).doc(id)) : null;
      const d = snap?.exists ? ({ ...snap.data()!, id } as Doc) : null;
      return d && visibleTo(this.ctx, lp, id, d) ? d : null;
    }
    const d = await this.rawGet(path, id);
    return d && visibleTo(this.ctx, lp, id, d, this.sys) ? d : null;
  }

  /**
   * Run `fn` as the system (tenancy plan D3): unscoped reads, no shared-record check. For denormalization hooks (renames update
   * every artist's shows) and looked-up facts (act lookups). `derived: true` marks the entries written inside as `derived` (copies of a
   * change made elsewhere, like a platform admin's merge rewriting other artists' records), so undoing the run from the caller's artist
   * skips them instead of refusing. Allow-listed by file (tests/unit/tenancy-guard.test.ts).
   */
  async system<T>(fn: () => Promise<T>, opts: { derived?: boolean } = {}): Promise<T> {
    this.sysDepth++;
    if (opts.derived) this.deriving++;
    try { return await fn(); } finally { this.sysDepth--; if (opts.derived) this.deriving--; }
  }

  /**
   * A Writer in this same unit, bound to `artistId` as its admin: `createArtistFor` seeds a new artist's templates and project,
   * `invites.accept` makes the musician in the inviting artist. Allow-listed by file (tests/unit/tenancy-guard.test.ts).
   */
  forArtist(artistId: string): Writer<ArtistCtx> {
    const { uid, via, now, sessionId, client, touched } = this.ctx;
    const ctx: ArtistCtx = { uid, via, runId: this.runId, now, sessionId, client, touched, role: "admin", artistId };
    return new Writer(this.tx, ctx, this.unit);
  }

  /**
   * Query a collection; soft-deleted docs are hidden unless includeDeleted. Overlay-updated docs are reconciled.
   *
   * `pending` also brings in documents this unit created that Firestore has never seen. They cannot be filtered by the query's own constraints -- that would mean
   * reimplementing Firestore -- so they are returned to be narrowed by the caller, which is why this is off unless
   * asked for.
   */
  async query(path: string, build?: (q: Query) => Query, opts: { includeDeleted?: boolean; pending?: boolean } = {}): Promise<Doc[]> {
    const at = await queryBase(this.read, this.unit.located, this.ctx, this.sys, path);
    if (!at) return [];
    path = at.lp;
    const base = scoped(this.ctx, path, at.q, this.sys);
    if (!base) return [];
    const q = build ? build(base) : base;
    const snap = await this.tx.get(q);
    const docs = snap.docs.filter((d) => at.keep(d.ref));
    remember(this.unit.located, docs);
    const out = new Map<string, Doc>();
    for (const d of docs) out.set(d.id, { ...d.data(), id: d.id } as Doc);
    for (const [key, v] of this.overlay) {
      if (key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/") && (opts.pending || out.has(key.slice(path.length + 1)))) {
        const id = key.slice(path.length + 1);
        if (v) out.set(id, { ...v, id } as Doc); else out.delete(id);
      }
    }
    return [...out.values()].filter((d) => (opts.includeDeleted || !d.deletedAt) && visibleTo(this.ctx, path, d.id, d, this.sys));
  }

  private stampNew(id: string, body: Record<string, unknown>): DocumentData {
    return {
      ...body, id, schemaVersion: SCHEMA_VERSION, createdAt: this.now, updatedAt: this.now,
      createdBy: this.ctx.uid, updatedBy: this.ctx.uid, via: this.ctx.via, runId: this.runId, deletedAt: null, rev: 1,
    };
  }
  private stampUpdate(path: string, prev: DocumentData, body: Record<string, unknown>, deletedAt: Timestamp | null): DocumentData {
    const adoptedAt = prev.adoptedAt ?? (this.adopting.has(`${path}/${prev.id}`) ? this.now : undefined);
    return {
      ...body, ...(adoptedAt ? { adoptedAt } : {}), id: prev.id, schemaVersion: prev.schemaVersion ?? SCHEMA_VERSION, createdAt: prev.createdAt, createdBy: prev.createdBy,
      updatedAt: this.now, updatedBy: this.ctx.uid, via: this.ctx.via, runId: this.runId, deletedAt, rev: ((prev.rev as number | undefined) ?? 0) + 1,
    };
  }

  /**
   * May this call change the existing shared record `existing` (phase 1 of the tenancy plan)? Yes for anything that isn't a
   * top-level shared kind, inside `system()` (hooks, act lookups) and with a SystemCtx, for approved shared editors and platform admins, and for the
   * record's creator until someone approved adopts it. An approved person's first change to someone else's record adopts it.
   */
  private async mayChangeShared(path: string, existing: DocumentData): Promise<boolean> {
    if (path.includes("/") || !SHARED_KINDS.has(path)) return true;
    if (this.sys) return true;
    if (this.ctx.person) return false;
    const a = await accessOf(this.ctx as Ctx);
    if (a.sharedEditor || a.platformAdmin) {
      if (existing.createdBy !== this.ctx.uid && !existing.adoptedAt) this.adopting.add(`${path}/${existing.id}`);
      return true;
    }
    return existing.createdBy === this.ctx.uid && !existing.adoptedAt;
  }
  private async requireMayChange(path: string, existing: DocumentData) {
    if (!(await this.mayChangeShared(path, existing))) throw new AppError("not_approved", refusedMessage(path), 403);
  }

  private actor() {
    const c = this.ctx;
    return { uid: c.uid, via: c.via, ...(c.sessionId ? { sessionId: c.sessionId } : {}), ...(c.client ? { client: c.client } : {}) };
  }

  /**
   * The artist a record belongs to: its own `artistId`; a sub-collection doc (comments, activity, entries, tracks) and an id-keyed
   * one (showDeals, setlists: keyed by the show's id) take their parent's; an artist is its own. Null when none is known
   * (records written before tenancy phase 2, until the backfill).
   */
  private async artistIdFor(path: string, id: string, doc: DocumentData): Promise<string | null> {
    if (typeof doc.artistId === "string" && doc.artistId) return doc.artistId;
    return this.parentArtistId(path, id);
  }
  private async parentArtistId(path: string, id: string): Promise<string | null> {
    const kind = kindOf(path);
    if (kind === "artists") return id;
    const seg = path.split("/");
    if (seg.length >= 3) {
      const parentPath = seg.slice(0, -2).join("/"), parentId = seg[seg.length - 2];
      const parent = await this.rawGet(parentPath, parentId);
      return parent ? this.artistIdFor(parentPath, parentId, parent) : null;
    }
    const p = PARENTS[kind];
    if (p?.keyedById) {
      for (const k of p.kinds) {
        const parent = await this.rawGet(k, id);
        if (parent) return this.artistIdFor(k, id, parent);
      }
    }
    return null;
  }

  /**
   * The one scope of a history entry (tenancy plan D4): artist records get `artistId`; a person's records (users, their private
   * sub-collection, prefs) get `ownerUid`; shared directory records get `shared: true`. Shared and person entries carry an explicit
   * `artistId: null`, so a query can name it.
   */
  private async scopeFor(path: string, id: string, doc: DocumentData): Promise<{ artistId: string | null; ownerUid?: string; shared?: true }> {
    const kind = kindOf(path);
    const owner = ownerOf(kind);
    if (owner === "user") {
      const seg = path.split("/");
      const ownerUid = seg.length >= 3 ? seg[seg.length - 2] : kind === "users" || kind === "userPrefs" ? id : ((doc.uid ?? doc.createdBy) as string);
      return { artistId: null, ownerUid };
    }
    if (owner === "shared") return { artistId: null, shared: true };
    return { artistId: await this.artistIdFor(path, id, doc) };
  }

  /**
   * The artist a new artist record goes into, stamped before it is validated (tenancy plan D3): a sub-collection doc (comments,
   * activity, entries, tracks) and a show-keyed one (showDeals, setlists) take their parent's; others the ctx's. Refused (not_found)
   * when the parent is another artist's, when the input names another artist, or with no artist at all. Inside `system()` or with a
   * SystemCtx, the input's or the parent's artist is used (they must agree).
   */
  private async stampArtist(path: string, id: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const kind = kindOf(path);
    const owner = ownerOf(kind);
    if (owner === "artist-self") {
      if (!this.sys && id !== this.ctx.artistId) throw notFound(path, id);
      return input;
    }
    if (owner !== "artist") return input;
    const named = typeof input.artistId === "string" && input.artistId ? input.artistId : undefined;
    const p = PARENTS[kind];
    const isSub = path.split("/").length >= 3;
    const parent = isSub || p?.keyedById ? await this.parentArtistId(path, id) : null;
    if (isSub && !parent) throw notFound(path, id);
    let artistId: string | undefined;
    if (this.sys) {
      if (named && parent && named !== parent) throw notFound(path, id);
      artistId = parent ?? named ?? this.ctx.artistId;
    } else {
      const mine = this.ctx.artistId;
      if (!mine || (named && named !== mine) || (parent && parent !== mine)) throw notFound(path, id);
      artistId = mine;
    }
    if (!artistId) throw new AppError("artist_required", `A new ${kind} record needs its artist`, 400);
    return { ...input, artistId };
  }

  /**
   * Memberships carry the person's musician in each artist (`Membership.musicianId`, plan D2). Refuses a link to a musician
   * outside that membership's artist, or to one already linked to someone else.
   */
  private async checkMemberships(uid: string, before: DocumentData | null, doc: Record<string, unknown>) {
    if (this.sys) return;
    const prev = new Map(((before?.artists ?? []) as Membership[]).map((m) => [m.artistId, m.musicianId]));
    for (const m of (Array.isArray(doc.artists) ? doc.artists : []) as Membership[]) {
      if (!m.musicianId || prev.get(m.artistId) === m.musicianId) continue;
      const mus = await this.rawGet("musicians", m.musicianId);
      if (!mus || mus.deletedAt || mus.artistId !== m.artistId) throw new AppError("not_found", "Musician not found", 404);
      if (mus.userId && mus.userId !== uid) throw new AppError("conflict", "That musician already has a login", 409);
    }
  }

  private async commit(path: string, id: string, doc: DocumentData, op: "create" | "update" | "delete" | "merge" | "restore", diff: Diff, autosave = false) {
    const scope = await this.scopeFor(path, id, doc);
    const ref = this.refFor(path, id, doc);
    const hist = ref.collection("history").doc(revId(doc.rev as number));
    const seq = this.unit.seq++;
    // Read now, not at flush: by then the hook that made this write has returned.
    const derived = this.deriving > 0;
    this.overlay.set(`${path}/${id}`, doc);
    (this.ctx.touched ??= {})[id] = doc.rev as number;
    const link = op === "create" && LINKED_KINDS.has(path) && typeof doc.artistId === "string" ? this.fs.doc(linkPath(path, id)) : null;
    this.pending.push((tx) => {
      tx.set(ref, doc);
      if (link) tx.set(link, { kind: path, id, artistId: doc.artistId });
      tx.set(hist, {
        id: hist.id, schemaVersion: SCHEMA_VERSION, createdAt: this.now, updatedAt: this.now,
        createdBy: this.ctx.uid, updatedBy: this.ctx.uid, via: this.ctx.via, runId: this.runId, deletedAt: null, rev: 1,
        entity: { kind: path, id }, op, ...scope, diff, seq, actor: this.actor(), docRev: doc.rev,
        ...(autosave ? { autosave: true } : {}), ...(derived ? { derived: true } : {}),
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
    const ref = this.refFor(path, id, doc);
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
    path = splitPath(path).logical;
    const kind = kindOf(path);
    const d = def(kind);
    const id = opts.id ?? this.fs.collection(path).doc().id;
    if (this.ctx.person && !this.sys && (ownerOf(kind) === "artist" || ownerOf(kind) === "artist-self")) throw notFound(path, id);
    const stamped = await this.stampArtist(path, id, input);
    if (kind === "users") await this.checkMemberships(id, null, stamped);
    const { data, computed } = prepare(kind, stamped);
    if (d.dedupe && computed.matchKey) {
      const hits = await this.query(path, (q) => q.where("matchKey", "==", computed.matchKey).limit(5));
      if (hits[0]) return this.mergeInto(path, hits[0], data);
    }
    // An id-keyed create (showDeals, setlists, *Notes, mcpTokens…) never replaces a record; another artist's reads as not found.
    const there = opts.id ? await this.rawGet(path, id) : null;
    if (there) throw visibleTo(this.ctx, path, id, there, this.sys) ? new AppError("already_exists", `${path}/${id} already exists`, 409) : notFound(path, id);
    const doc = clean(this.stampNew(id, { ...data, ...computed }));
    // A copy of an older record (comments carried from a pitch to its show) keeps the original's creation time and creator.
    if (opts.keep) Object.assign(doc, opts.keep);
    await this.commit(path, id, doc, "create", diffDocs(null, doc));
    return { id, merged: false };
  }

  private async mergeInto(path: string, existing: Doc, incoming: Record<string, unknown>) {
    const kind = kindOf(path);
    // Adding "a venue that already exists" links to it; only an approved person's gaps fill the shared record.
    if (!(await this.mayChangeShared(path, existing))) return { id: existing.id, merged: true };
    const base = writable(existing);
    const filled: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(incoming)) filled[k] = mergeFill(base[k], v);
    if (kind === "users") await this.checkMemberships(existing.id, existing, filled);
    const { data, computed } = prepare(kind, filled);
    const next = clean(this.stampUpdate(path, existing, { ...data, ...computed }, existing.deletedAt ?? null));
    const diff = diffDocs(existing, next);
    if (Object.keys(diff).length) {
      await this.commit(path, existing.id, next, "merge", diff);
      await this.afterChange(path, existing, next);
    }
    return { id: existing.id, merged: true };
  }

  /** Explicit merge of input into an existing doc (fill gaps, union arrays). */
  async merge(path: string, id: string, input: Record<string, unknown>) {
    path = splitPath(path).logical;
    const dm = def(kindOf(path));
    if (dm.immutable || dm.appendOnly) throw new AppError("immutable", `${kindOf(path)} documents are never edited`, 409);
    const existing = await this.get(path, id);
    if (!existing || existing.deletedAt) throw new AppError("not_found", `${path}/${id} not found`, 404);
    this.refuseMove(path, existing, input);
    await this.requireMayChange(path, existing);
    return this.mergeInto(path, existing, input);
  }

  /** No write moves a record to another artist. */
  private refuseMove(path: string, existing: DocumentData, patch: Record<string, unknown>) {
    if (ownerOf(kindOf(path)) === "artist" && "artistId" in patch && patch.artistId !== existing.artistId) {
      throw new AppError("invalid_input", "A record can't move to another artist", 400);
    }
  }

  /** Patch top-level fields. null removes an optional field. */
  async update(path: string, id: string, patch: Record<string, unknown>) {
    path = splitPath(path).logical;
    const kind = kindOf(path);
    const d = def(kind);
    if (d.immutable || d.appendOnly) throw new AppError("immutable", `${kind} documents are never edited`, 409);
    const existing = await this.get(path, id);
    if (!existing || existing.deletedAt) throw new AppError("not_found", `${path}/${id} not found`, 404);
    this.refuseMove(path, existing, patch);
    const allowed = await this.mayChangeShared(path, existing);
    const bad = Object.keys(patch).filter((k) => COMMON.has(k) || (computedFields[kind] ?? []).includes(k));
    if (bad.length) throw new AppError("invalid_input", `Cannot set server fields: ${bad.join(", ")}`, 400);
    const merged: Record<string, unknown> = { ...writable(existing) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete merged[k]; else merged[k] = v;
    }
    if (kind === "users") await this.checkMemberships(id, existing, merged);
    const { data, computed } = prepare(kind, merged);
    if (d.dedupe && computed.matchKey && computed.matchKey !== existing.matchKey) {
      const hits = await this.query(path, (q) => q.where("matchKey", "==", computed.matchKey).limit(5));
      if (hits.some((h) => h.id !== id)) throw new AppError("duplicate", `Another ${kind} already matches that name`, 409);
    }
    let next = clean(this.stampUpdate(path, existing, { ...data, ...computed }, null));
    const diff = diffDocs(existing, next);
    if (!Object.keys(diff).length) return { id, changed: false };
    if (!allowed) throw new AppError("not_approved", refusedMessage(path), 403);
    const br = this.ctx.baseRev;
    if (br?.id === id) await this.checkConflict(path, id, br.rev, Object.keys(diff));
    const fold = await this.foldTarget(path, existing, diff);
    if (fold) {
      this.unit.coalescedRunId = fold.last.runId as string;
      next = { ...next, runId: this.unit.coalescedRunId };
      this.commitFolded(path, id, next, fold);
    } else await this.commit(path, id, next, "update", diff, !!this.ctx.autosave && this.ctx.via === "app");
    await this.afterChange(path, existing, next);
    return { id, changed: true };
  }

  async softDelete(path: string, id: string) {
    path = splitPath(path).logical;
    const kind = kindOf(path);
    if (def(kind).immutable || def(kind).appendOnly) throw new AppError("immutable", `${kind} documents are never deleted`, 409);
    const existing = await this.get(path, id);
    if (!existing) throw new AppError("not_found", `${path}/${id} not found`, 404);
    if (existing.deletedAt) return { id, changed: false };
    await this.requireMayChange(path, existing);
    const next = clean(this.stampUpdate(path, existing, writable(existing), this.now));
    await this.commit(path, id, next, "delete", diffDocs(existing, next));
    return { id, changed: true };
  }

  async restore(path: string, id: string) {
    path = splitPath(path).logical;
    const existing = await this.get(path, id);
    if (!existing) throw new AppError("not_found", `${path}/${id} not found`, 404);
    if (!existing.deletedAt) return { id, changed: false };
    await this.requireMayChange(path, existing);
    const next = clean(this.stampUpdate(path, existing, writable(existing), null));
    await this.commit(path, id, next, "restore", diffDocs(existing, next));
    return { id, changed: true };
  }

  /**
   * Reverse one history entry (used by undo only). create -> soft delete, delete -> restore, restore -> soft delete,
   * update/merge -> put the `before` values back. Works on append-only docs too (activity); never on immutable ones.
   */
  async revert(path: string, id: string, op: string, diff: Diff): Promise<{ changed: boolean; as: "delete" | "restore" | "update"; skipped?: string[] }> {
    path = splitPath(path).logical;
    const kind = kindOf(path);
    const d = def(kind);
    if (d.immutable) throw new AppError("immutable", `${kind} documents are never edited`, 409);
    const existing = await this.get(path, id);
    if (!existing) throw new AppError("not_found", `${path}/${id} not found`, 404);
    const allowed = await this.mayChangeShared(path, existing);
    const refuse = () => { if (!allowed) throw new AppError("not_approved", refusedMessage(path), 403); };
    if (op === "create" || op === "restore") {
      if (existing.deletedAt) return { changed: false, as: "delete" };
      refuse();
      const next = clean(this.stampUpdate(path, existing, writable(existing), this.now));
      await this.commit(path, id, next, "delete", diffDocs(existing, next));
      await this.afterChange(path, existing, next);
      return { changed: true, as: "delete" };
    }
    if (op === "delete") {
      if (!existing.deletedAt) return { changed: false, as: "restore" };
      refuse();
      const next = clean(this.stampUpdate(path, existing, writable(existing), null));
      await this.commit(path, id, next, "restore", diffDocs(existing, next));
      await this.afterChange(path, existing, next);
      return { changed: true, as: "restore" };
    }
    const computed = new Set(computedFields[kind] ?? []);
    const merged: Record<string, unknown> = { ...writable(existing) };
    const skipped: string[] = [];
    for (const [k, v] of Object.entries(diff)) {
      if (COMMON.has(k) || computed.has(k) || k === "artistId") continue; // no undo moves a record to another artist
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
    const next = clean(this.stampUpdate(path, existing, { ...data, ...comp }, existing.deletedAt ?? null));
    const changes = diffDocs(existing, next);
    if (!Object.keys(changes).length) return { changed: false, as: "update", ...(skipped.length ? { skipped } : {}) };
    refuse();
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
      this.deriving++;
      try { await this.system(() => h.refresh(this as unknown as Writer, before.id, after, before)); } finally { this.deriving--; }
    }
  }
}

/** One transaction. Retries re-run fn, so keep it free of side effects other than writer calls. */
export async function run<T, C extends AnyCtx = Ctx>(ctx: C, fn: (w: Writer<C>) => Promise<T>): Promise<T> {
  const { readOnly } = await layout();
  let last: Writer<C> | undefined;
  const out = await firestore().runTransaction(async (tx) => {
    const w = (last = new Writer<C>(tx, ctx));
    const out = await fn(w);
    // Phase 10's copy window: nothing is written (a run that only read still answers).
    if (readOnly && w.hasWrites && !ctx.system) throw readOnlyError();
    w.flush();
    return out;
  });
  if (last?.coalescedRunId) ctx.runId = last.coalescedRunId; // the caller (and the response) now refer to the entry that was folded into
  return out;
}

/**
 * The one write outside history: `mcpTokens.lastUsedAt` is telemetry, not business data, so it is stamped directly
 * (no history entry, so undoing an AI run never blanks it) and at most once a minute per token.
 */
export async function touchLastUsed(hash: string, now = new Date(), collection: "mcpTokens" | "shortcutTokens" = "mcpTokens"): Promise<void> {
  const ref = firestore().collection(collection).doc(hash);
  const snap = await ref.get();
  const last = snap.data()?.lastUsedAt as Timestamp | undefined;
  if (last && now.getTime() - last.toMillis() < 60_000) return;
  await ref.update({ lastUsedAt: Timestamp.fromDate(now) });
}

/**
 * Plain reads (not part of a write unit) and one-call writes. Every call takes the ctx first (tenancy plan D3): with an ArtistCtx
 * reads of artist kinds are scoped to its artist; with a SystemCtx they are unscoped (allow-listed, tests/unit/tenancy-guard.test.ts).
 */
export const db = {
  run,
  create: (ctx: AnyCtx, path: string, input: Record<string, unknown>, opts?: { id?: string }) => run(ctx, (w) => w.create(path, input, opts)),
  update: (ctx: AnyCtx, path: string, id: string, patch: Record<string, unknown>) => run(ctx, (w) => w.update(path, id, patch)),
  merge: (ctx: AnyCtx, path: string, id: string, input: Record<string, unknown>) => run(ctx, (w) => w.merge(path, id, input)),
  softDelete: (ctx: AnyCtx, path: string, id: string) => run(ctx, (w) => w.softDelete(path, id)),
  restore: (ctx: AnyCtx, path: string, id: string) => run(ctx, (w) => w.restore(path, id)),
  /**
   * One doc (including soft-deleted); another artist's record is null. `at.artistId` says where a system read should look (nested
   * layout: a link that names its artist), saving the lookup.
   */
  async get(ctx: AnyCtx, path: string, id: string, at: { artistId?: string } = {}): Promise<Doc | null> {
    await layout();
    const { logical: lp, artistId: named } = splitPath(path);
    if (!ctx.system && named && named !== ctx.artistId) return null;
    const col = await collectionAt(plainReader, new Map(), ctx, !!ctx.system, lp, id, named ?? at.artistId);
    if (!col) return null;
    const s = await firestore().collection(col).doc(id).get();
    if (!s.exists) return null;
    const d = { ...s.data()!, id } as Doc;
    return visibleTo(ctx, lp, id, d) ? d : null;
  },
  async list(ctx: AnyCtx, path: string, build?: (q: Query) => Query, opts: { includeDeleted?: boolean } = {}): Promise<Doc[]> {
    await layout();
    const at = await queryBase(plainReader, new Map(), ctx, !!ctx.system, path);
    if (!at) return [];
    const base = scoped(ctx, at.lp, at.q);
    if (!base) return [];
    const s = await (build ? build(base) : base).get();
    return s.docs.filter((d) => at.keep(d.ref)).map((d) => ({ ...d.data(), id: d.id }) as Doc).filter((d) => (opts.includeDeleted || !d.deletedAt) && visibleTo(ctx, at.lp, d.id, d));
  },
  /**
   * Collection-group query (every collection with this name, at any depth). Rows carry their full stored `path`. Copies the other layout
   * still holds (phase 10, before the old copies are deleted) are left out.
   */
  async listGroup(ctx: AnyCtx, group: string, build?: (q: Query) => Query): Promise<(Doc & { path: string })[]> {
    await layout();
    const base = scoped(ctx, group, firestore().collectionGroup(group));
    if (!base) return [];
    const s = await (build ? build(base) : base).get();
    return s.docs.filter((d) => inLayout(d.ref.path)).map((d) => ({ ...d.data(), id: d.id, path: d.ref.path }) as Doc & { path: string })
      .filter((d) => !d.deletedAt && visibleTo(ctx, splitPath(d.path.split("/").slice(0, -1).join("/")).logical, d.id, d));
  },
  /** History entries of one record the ctx can see, newest first (a direct read of its subcollection). */
  async history(ctx: AnyCtx, path: string, id: string, limit = 50): Promise<Doc[]> {
    if (!(await db.get(ctx, path, id))) return [];
    return db.list(ctx, historyPath(path, id), (q) => q.orderBy("docRev", "desc").limit(limit));
  },
};
