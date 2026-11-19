"use client";
import { useEffect, useState } from "react";
import { nestedPaths } from "@/schema/owners";

export const VERSION_CHECK_MS = 10 * 60_000;
/** While Roadie is read-only, how often a tab looks for the end of it. */
export const READ_ONLY_CHECK_MS = 30_000;

export interface ServerVersion { buildId?: string; nestedPaths?: boolean; readOnly?: boolean }
async function serverVersion(): Promise<ServerVersion | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    return res.ok ? ((await res.json()) as ServerVersion) : null;
  } catch {
    return null;
  }
}

/**
 * What the server runs now, from /api/version; null when it can't be told (offline, an error). A server on another data layout than
 * this tab's (tenancy phase 10 flipped `nestedPaths`) counts as a new build: the tab's paths are stale until it reloads.
 */
async function serverBuildId(): Promise<string | null> {
  const v = await serverVersion();
  if (!v?.buildId) return null;
  return typeof v.nestedPaths === "boolean" && v.nestedPaths !== nestedPaths() ? `${v.buildId}+layout` : v.buildId;
}

/**
 * True while Roadie is read-only (phase 10's copy window): starts from the session's answer, then asks /api/version on focus and
 * every 30 seconds while it lasts, every 10 minutes otherwise.
 */
export function useReadOnly(initial: boolean, fetchVersion: () => Promise<ServerVersion | null> = serverVersion): boolean {
  const [readOnly, setReadOnly] = useState(initial);
  useEffect(() => { setReadOnly(initial); }, [initial]);
  useEffect(() => {
    let alive = true;
    const check = async () => { const v = await fetchVersion(); if (alive && v && typeof v.readOnly === "boolean") setReadOnly(v.readOnly); };
    window.addEventListener("focus", check);
    const timer = setInterval(check, readOnly ? READ_ONLY_CHECK_MS : VERSION_CHECK_MS);
    return () => { alive = false; window.removeEventListener("focus", check); clearInterval(timer); };
  }, [readOnly, fetchVersion]);
  return readOnly;
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
