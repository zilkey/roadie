"use client";
import { useEffect, useState } from "react";
import Link from "@/lib/artist";
import { useRouter } from "next/navigation";
import { canGoBackInApp } from "@/lib/backLink";

/**
 * The link at the top of a page that can be reached from several places. It goes back to where you came from (history
 * back) and reads "Back"; with nothing earlier in the app (a shared link, a fresh tab) it is a plain link to the fixed
 * parent, labelled with it. Without JavaScript it is that plain link too.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  const [canBack, setCanBack] = useState(false);
  useEffect(() => {
    const n = (window as unknown as { navigation?: { entries(): { url: string }[]; currentEntry: { index: number } | null } }).navigation;
    setCanBack(canGoBackInApp(location.origin, n?.currentEntry ? { entries: n.entries().map((e) => e.url), index: n.currentEntry.index } : null, window.history.length));
  }, []);
  return (
    <Link href={href} className="back-link" data-testid="back"
      onClick={canBack ? (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); router.back(); } : undefined}>
      ← {canBack ? "Back" : label}
    </Link>
  );
}
