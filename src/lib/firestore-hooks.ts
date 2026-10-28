"use client";
import { useEffect, useState } from "react";
import { collection, collectionGroup, doc, documentId, limit as limitTo, onSnapshot, orderBy, query, where, type WhereFilterOp } from "firebase/firestore";
import { clientDb } from "./firebase-client";
import { useAuth } from "./auth";
import { useBusyWhile } from "./busy";

export type Row<T> = T & { id: string };
type Where = [field: string, op: WhereFilterOp, value: unknown];

/**
 * Live read-only listener. Soft-deleted docs are hidden. Sort client-side (avoids composite indexes). Client writes are denied by rules: use runCommand.
 * `group` reads every collection with that name (a collection-group query, needs an index in firestore.indexes.json when combined with `order`);
 * `order` and `limit` are applied by the server; `includeDeleted` skips the soft-delete filter (history entries are never deleted).
 */
export function useCollection<T = Record<string, unknown>>(path: string, opts: { where?: Where[]; skip?: boolean; group?: boolean; order?: [field: string, dir: "asc" | "desc"]; limit?: number; includeDeleted?: boolean } = {}) {
  const { state } = useAuth();
  const ready = state.status === "ready" && !opts.skip;
  const [rows, setRows] = useState<Row<T>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([path, opts]);
  useEffect(() => {
    if (!ready) return;
    const cs = [
      ...(opts.includeDeleted ? [] : [where("deletedAt", "==", null)]), ...(opts.where ?? []).map(([f, o, v]) => where(f, o, v)),
      ...(opts.order ? [orderBy(opts.order[0], opts.order[1])] : []), ...(opts.limit ? [limitTo(opts.limit)] : []),
    ];
    return onSnapshot(
      query(opts.group ? collectionGroup(clientDb(), path) : collection(clientDb(), path), ...cs),
      (s) => { setRows(s.docs.map((d) => ({ ...(d.data() as T), id: d.id }))); setError(null); },
      (e) => setError(e.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);
  const loading = rows === null && !error && !opts.skip;
  useBusyWhile(loading);
  return { rows, error, loading };
}

/** Live read-only listener on one doc. `doc` is null when it does not exist or is soft-deleted (`includeDeleted` returns the archived doc, with its `deletedAt`). */
export function useDoc<T = Record<string, unknown>>(path: string, id: string, opts: { includeDeleted?: boolean } = {}) {
  const { state } = useAuth();
  const ready = state.status === "ready";
  const [value, setValue] = useState<{ doc: Row<T> | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    return onSnapshot(
      doc(clientDb(), path, id),
      (s) => { const d = s.data(); setValue({ doc: s.exists() && (opts.includeDeleted || !d?.deletedAt) ? ({ ...(d as T), id: s.id }) : null }); setError(null); },
      (e) => setError(e.message),
    );
  }, [ready, path, id, opts.includeDeleted]); // eslint-disable-line react-hooks/exhaustive-deps
  const loading = value === null && !error;
  useBusyWhile(loading);
  return { doc: value?.doc ?? null, loading, error };
}

/**
 * Live read-only listener on a set of docs by id (in chunks of 30, Firestore's `in` limit): one read per doc, however big the
 * collection. Soft-deleted and missing docs are left out. `skip` subscribes to nothing.
 */
export function useDocs<T = Record<string, unknown>>(path: string, ids: readonly string[], opts: { skip?: boolean } = {}) {
  const { state } = useAuth();
  const ready = state.status === "ready" && !opts.skip;
  const [byChunk, setByChunk] = useState<Record<number, Row<T>[]>>({});
  const [error, setError] = useState<string | null>(null);
  const key = [...new Set(ids)].sort().join(",");
  useEffect(() => {
    setByChunk({});
    if (!ready || !key) return;
    const all = key.split(",");
    const offs: (() => void)[] = [];
    for (let i = 0; i < all.length; i += 30) {
      const n = i;
      offs.push(onSnapshot(
        query(collection(clientDb(), path), where(documentId(), "in", all.slice(i, i + 30))),
        (s) => { setByChunk((m) => ({ ...m, [n]: s.docs.filter((d) => !d.data().deletedAt).map((d) => ({ ...(d.data() as T), id: d.id })) })); setError(null); },
        (e) => setError(e.message),
      ));
    }
    return () => offs.forEach((f) => f());
  }, [ready, path, key]);
  const rows = Object.values(byChunk).flat();
  const loading = ready && !!key && Object.keys(byChunk).length < Math.ceil(key.split(",").length / 30) && !error;
  useBusyWhile(loading);
  return { rows, byId: new Map(rows.map((r) => [r.id, r])), error, loading };
}
