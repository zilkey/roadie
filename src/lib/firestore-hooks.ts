"use client";
import { useEffect, useState } from "react";
import { collection, collectionGroup, doc, limit as limitTo, onSnapshot, orderBy, query, where, type WhereFilterOp } from "firebase/firestore";
import { clientDb } from "./firebase-client";
import { useAuth } from "./auth";

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
  return { rows, error, loading: rows === null && !error && !opts.skip };
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
  return { doc: value?.doc ?? null, loading: value === null && !error, error };
}
