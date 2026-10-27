"use client";
import { useEffect, useRef, useState } from "react";
import { runCommand } from "@/lib/commands";
import { FESTIVAL_PAGE_SIZE, type FestivalRef, type FestivalSort } from "@/lib/festivalPage";

/**
 * The Festivals tab's rows in the server's order (festivals.page): the first page, then one more per `more()`. The search and the sort
 * run on the server, so every page is in the same order. `version` changes when a festival or edition changes: the pages already shown
 * are fetched again in one call, so an edited deadline moves to its place.
 */
export function useFestivalPage({ q, sort, enabled, version }: { q: string; sort: FestivalSort; enabled: boolean; version: string }) {
  const [rows, setRows] = useState<FestivalRef[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const shown = useRef(FESTIVAL_PAGE_SIZE);
  const ask = useRef(0);

  async function load(offset: number, limit: number, replace: boolean) {
    const n = ++ask.current;
    try {
      const r = await runCommand<{ total: number; rows: FestivalRef[] }>("festivals.page", { q, sort, offset, limit });
      if (n !== ask.current) return; // a newer search or sort has asked since
      setTotal(r.total); setError(null);
      setRows((prev) => (replace || !prev ? r.rows : [...prev, ...r.rows]));
    } catch (e) { if (n === ask.current) setError((e as Error).message); }
  }

  // A new search or sort starts over at the first page (the search waits for a pause in typing).
  useEffect(() => {
    if (!enabled) return;
    shown.current = FESTIVAL_PAGE_SIZE;
    const t = setTimeout(() => void load(0, FESTIVAL_PAGE_SIZE, true), q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, q, sort]);
  // The data changed: the same pages again, in the new order.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (enabled && rows) void load(0, shown.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  async function more() {
    if (!rows) return;
    setLoadingMore(true);
    const offset = rows.length;
    shown.current = offset + FESTIVAL_PAGE_SIZE;
    await load(offset, FESTIVAL_PAGE_SIZE, false);
    setLoadingMore(false);
  }
  return { rows, total, error, more, loadingMore, hasMore: !!rows && rows.length < total };
}
