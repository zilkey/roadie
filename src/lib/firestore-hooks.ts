"use client";
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where, type WhereFilterOp } from "firebase/firestore";
import { clientDb } from "./firebase-client";
import { useAuth } from "./auth";

export type Row<T> = T & { id: string };
type Where = [field: string, op: WhereFilterOp, value: unknown];

/** Live read-only listener. Soft-deleted docs are hidden. Sort client-side (avoids composite indexes). Client writes are denied by rules: use runCommand. */
export function useCollection<T = Record<string, unknown>>(path: string, opts: { where?: Where[] } = {}) {
  const { state } = useAuth();
  const ready = state.status === "ready";
  const [rows, setRows] = useState<Row<T>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([path, opts]);
  useEffect(() => {
    if (!ready) return;
    const cs = [where("deletedAt", "==", null), ...(opts.where ?? []).map(([f, o, v]) => where(f, o, v))];
    return onSnapshot(
      query(collection(clientDb(), path), ...cs),
      (s) => { setRows(s.docs.map((d) => ({ ...(d.data() as T), id: d.id }))); setError(null); },
      (e) => setError(e.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);
  return { rows, error, loading: rows === null && !error };
}

/** Live read-only listener on one doc. `doc` is null when it does not exist or is soft-deleted. */
export function useDoc<T = Record<string, unknown>>(path: string, id: string) {
  const { state } = useAuth();
  const ready = state.status === "ready";
  const [value, setValue] = useState<{ doc: Row<T> | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    return onSnapshot(
      doc(clientDb(), path, id),
      (s) => { const d = s.data(); setValue({ doc: s.exists() && !d?.deletedAt ? ({ ...(d as T), id: s.id }) : null }); setError(null); },
      (e) => setError(e.message),
    );
  }, [ready, path, id]);
  return { doc: value?.doc ?? null, loading: value === null && !error, error };
}
