"use client";
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where, type WhereFilterOp } from "firebase/firestore";
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
