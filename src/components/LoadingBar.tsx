"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { beginBusy, useIsBusy } from "@/lib/busy";

const SHOW_AFTER_MS = 150;
const NAV_GIVE_UP_MS = 15_000;

/** A tap on a same-origin link counts as busy until the URL changes (the new page rendered), so a slow navigation never looks like nothing happened. */
function useNavigationBusy() {
  const path = usePathname();
  const search = useSearchParams().toString();
  const end = useRef<(() => void) | null>(null);
  useEffect(() => {
    end.current?.(); end.current = null; // the page changed: done
  }, [path, search]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin || (to.pathname === location.pathname && to.search === location.search)) return;
      end.current?.(); clearTimeout(timer);
      end.current = beginBusy();
      timer = setTimeout(() => { end.current?.(); end.current = null; }, NAV_GIVE_UP_MS);
    };
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("click", onClick); clearTimeout(timer); end.current?.(); end.current = null; };
  }, []);
}

/**
 * A thin accent bar across the top while something is loading: appears after 150 ms (fast loads don't flash), creeps toward 80%,
 * then completes and fades. With reduced motion it is simply on or off.
 */
export function LoadingBar() {
  useNavigationBusy();
  const busy = useIsBusy();
  const [phase, setPhase] = useState<"idle" | "run" | "done">("idle");
  const shown = useRef(false);
  useEffect(() => {
    if (busy) {
      if (shown.current) { setPhase("run"); return; }
      const h = setTimeout(() => { shown.current = true; setPhase("run"); }, SHOW_AFTER_MS);
      return () => clearTimeout(h);
    }
    if (!shown.current) return;
    shown.current = false;
    setPhase("done");
    const h = setTimeout(() => setPhase("idle"), 400);
    return () => clearTimeout(h);
  }, [busy]);
  useEffect(() => {
    document.querySelector("main")?.setAttribute("aria-busy", busy ? "true" : "false");
  }, [busy]);
  return (
    <div className="loadbar" data-phase={phase} role="progressbar" aria-label="Loading" aria-hidden={phase === "idle"} data-testid="loading-bar">
      <div className="loadbar-fill" />
    </div>
  );
}
