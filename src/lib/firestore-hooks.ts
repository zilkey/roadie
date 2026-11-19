"use client";
import { useEffect, useState } from "react";
import { collection, collectionGroup, doc, documentId, limit as limitTo, onSnapshot, orderBy, query, where, type WhereFilterOp } from "firebase/firestore";
import { clientDb } from "./firebase-client";
import { useAuth } from "./auth";
import { useBusyWhile } from "./busy";
import { useMaybeArtist } from "./artist";
import { scopeQuery, scopedDocPath } from "./client-scope";
import { inLayout } from "@/schema/owners";

export type Row<T> = T & { id: string };
type Where = [field: string, op: WhereFilterOp, value: unknown];

/**
 * Live read-only listener. Soft-deleted docs are hidden. Sort client-side (avoids composite indexes). Client writes are denied by rules: use runCommand.
 * `group` reads every collection with that name (a collection-group query, needs an index in firestore.indexes.json when combined with `order`);
 * `order` and `limit` are applied by the server; `includeDeleted` skips the soft-delete filter (history entries are never deleted).
 * `fromCache` is true while `rows` are the SDK's local answer, not yet the server's: a new query (a bigger `limit`, say) can first get
 * only the docs an earlier listener left in the cache, then the server's full answer. Pass `waitForServer` to rely on it: it also
 * fires when the server confirms the cache's answer unchanged (an empty one, say), which the SDK otherwise doesn't report.
 * Tenancy (src/lib/client-scope.ts): an artist kind is asked for only in the open artist (`artistId ==`), a users list only for its
 * people (`artistIds array-contains`); with no artist open they aren't asked for and `rows` is empty.
 */
export function useCollection<T = Record<string, unknown>>(path: string, opts: { where?: Where[]; skip?: boolean; group?: boolean; order?: [field: string, dir: "asc" | "desc"]; limit?: number; includeDeleted?: boolean; waitForServer?: boolean } = {}) {
  const { state } = useAuth();
  const artistId = useMaybeArtist()?.artistId;
  const scoped = scopeQuery(path, opts, artistId);
  const skip = !!opts.skip || !scoped;
  const ready = state.status === "ready" && !skip;
  const [rows, setRows] = useState<Row<T>[] | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([path, opts, artistId, scoped?.path]);
  useEffect(() => {
    if (!ready || !scoped) return;
    const cs = [
      ...scoped.where.map(([f, o, v]) => where(f, o as WhereFilterOp, v)), ...(opts.includeDeleted ? [] : [where("deletedAt", "==", null)]),
      ...(opts.order ? [orderBy(opts.order[0], opts.order[1])] : []), ...(opts.limit ? [limitTo(opts.limit)] : []),
    ];
    return onSnapshot(
      query(opts.group ? collectionGroup(clientDb(), scoped.path) : collection(clientDb(), scoped.path), ...cs),
      { includeMetadataChanges: !!opts.waitForServer },
      // A collection group also finds the copies the other layout still holds (tenancy phase 10, before the old ones are deleted).
      (s) => { setRows(s.docs.filter((d) => !opts.group || inLayout(d.ref.path)).map((d) => ({ ...(d.data() as T), id: d.id }))); setFromCache(s.metadata.fromCache); setError(null); },
      (e) => setError(e.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);
  const loading = rows === null && !error && !skip;
  useBusyWhile(loading);
  // An artist kind with no artist open: nothing to ask for, so nothing (not "loading").
  return { rows: !scoped && !opts.skip ? ([] as Row<T>[]) : rows, error, loading, fromCache };
}

/**
 * Live read-only listener on one doc. `doc` is null when it does not exist or is soft-deleted (`includeDeleted` returns the archived doc,
 * with its `deletedAt`). `skip` (or a blank id) reads nothing: doc null, not loading. A get by id needs no artist filter (the rules check
 * the doc itself), but an artist kind is still read only inside an artist, at the path `pathOf` gives.
 */
export function useDoc<T = Record<string, unknown>>(path: string, id: string, opts: { includeDeleted?: boolean; skip?: boolean } = {}) {
  const { state } = useAuth();
  const at = scopedDocPath(path, useMaybeArtist()?.artistId);
  const skip = !!opts.skip || !id || !at;
  const ready = state.status === "ready" && !skip;
  const [value, setValue] = useState<{ doc: Row<T> | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !at) return;
    return onSnapshot(
      doc(clientDb(), at, id),
      (s) => { const d = s.data(); setValue({ doc: s.exists() && (opts.includeDeleted || !d?.deletedAt) ? ({ ...(d as T), id: s.id }) : null }); setError(null); },
      (e) => setError(e.message),
    );
  }, [ready, at, id, opts.includeDeleted]); // eslint-disable-line react-hooks/exhaustive-deps
  const loading = !skip && value === null && !error;
  useBusyWhile(loading);
  return { doc: skip ? null : value?.doc ?? null, loading, error };
}

/**
 * Live read-only listener on a set of docs by id (in chunks of 30, Firestore's `in` limit): one read per doc, however big the
 * collection. Soft-deleted and missing docs are left out. `skip` subscribes to nothing.
 */
export function useDocs<T = Record<string, unknown>>(path: string, ids: readonly string[], opts: { skip?: boolean } = {}) {
  const { state } = useAuth();
  const artistId = useMaybeArtist()?.artistId;
  const scoped = scopeQuery(path, {}, artistId);
  const ready = state.status === "ready" && !opts.skip && !!scoped;
  const [byChunk, setByChunk] = useState<Record<number, Row<T>[]>>({});
  const [error, setError] = useState<string | null>(null);
  const key = [...new Set(ids)].sort().join(",");
  const scope = JSON.stringify(scoped);
  useEffect(() => {
    setByChunk({});
    if (!ready || !key || !scoped) return;
    const all = key.split(",");
    const offs: (() => void)[] = [];
    for (let i = 0; i < all.length; i += 30) {
      const n = i;
      offs.push(onSnapshot(
        query(collection(clientDb(), scoped.path), ...scoped.where.map(([f, o, v]) => where(f, o as WhereFilterOp, v)), where(documentId(), "in", all.slice(i, i + 30))),
        (s) => { setByChunk((m) => ({ ...m, [n]: s.docs.filter((d) => !d.data().deletedAt).map((d) => ({ ...(d.data() as T), id: d.id })) })); setError(null); },
        (e) => setError(e.message),
      ));
    }
    return () => offs.forEach((f) => f());
  }, [ready, scope, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = Object.values(byChunk).flat();
  const loading = ready && !!key && Object.keys(byChunk).length < Math.ceil(key.split(",").length / 30) && !error;
  useBusyWhile(loading);
  return { rows, byId: new Map(rows.map((r) => [r.id, r])), error, loading };
}

/**
 * Live read-only listener on the docs whose array `field` holds any of `values` (array-contains-any, in chunks of 30, Firestore's
 * limit). No soft-delete filter (venueEvents have no deletedAt). An empty `values` or `skip` subscribes to nothing.
 */
export function useArrayContainsAny<T = Record<string, unknown>>(path: string, field: string, values: readonly string[], opts: { skip?: boolean } = {}) {
  const { state } = useAuth();
  const artistId = useMaybeArtist()?.artistId;
  const scoped = scopeQuery(path, {}, artistId);
  const ready = state.status === "ready" && !opts.skip && !!scoped;
  const [byChunk, setByChunk] = useState<Record<number, Row<T>[]>>({});
  const [error, setError] = useState<string | null>(null);
  const key = [...new Set(values)].sort().join(",");
  const scope = JSON.stringify(scoped);
  useEffect(() => {
    setByChunk({});
    if (!ready || !key || !scoped) return;
    const all = key.split(",");
    const offs: (() => void)[] = [];
    for (let i = 0; i < all.length; i += 30) {
      const n = i;
      offs.push(onSnapshot(
        query(collection(clientDb(), scoped.path), ...scoped.where.map(([f, o, v]) => where(f, o as WhereFilterOp, v)), where(field, "array-contains-any", all.slice(i, i + 30))),
        (s) => { setByChunk((m) => ({ ...m, [n]: s.docs.map((d) => ({ ...(d.data() as T), id: d.id })) })); setError(null); },
        (e) => setError(e.message),
      ));
    }
    return () => offs.forEach((f) => f());
  }, [ready, scope, field, key]); // eslint-disable-line react-hooks/exhaustive-deps
  // A doc can match two chunks (two of its acts in different chunks): keep one.
  const rows = [...new Map(Object.values(byChunk).flat().map((r) => [r.id, r])).values()];
  const loading = ready && !!key && Object.keys(byChunk).length < Math.ceil(key.split(",").length / 30) && !error;
  useBusyWhile(loading);
  return { rows, error, loading };
}
