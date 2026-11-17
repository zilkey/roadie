"use client";
import { useEffect, useState } from "react";

export const VERSION_CHECK_MS = 10 * 60_000;

/** What the server runs now, from /api/version; null when it can't be told (offline, an error). */
async function serverBuildId(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const { buildId } = (await res.json()) as { buildId?: string };
    return buildId || null;
  } catch {
    return null;
  }
}

/**
 * True once Roadie has been deployed since this tab loaded: checks /api/version when the tab gets focus or becomes
 * visible, and every 10 minutes. Stays true once seen (the tab still runs the old code until it reloads). A tab built
 * without an id (a test run of a component) never asks. The arguments are for tests.
 */
export function useNewVersion(
  current: string | undefined = process.env.NEXT_PUBLIC_BUILD_ID,
  fetchBuildId: () => Promise<string | null> = serverBuildId,
  everyMs = VERSION_CHECK_MS,
): boolean {
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    if (!current || updated) return;
    let alive = true;
    const check = async () => {
      const id = await fetchBuildId();
      if (alive && id && id !== current) setUpdated(true);
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, everyMs);
    return () => {
      alive = false;
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [current, fetchBuildId, everyMs, updated]);
  return updated;
}
