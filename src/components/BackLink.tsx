"use client";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useHref } from "@/lib/artist";
import { previousPath } from "@/lib/navHistory";

/**
 * The link at the top of a page. "parent" always goes to `href` and reads `← {label}`. "back" reads `← Back` and goes back through
 * history when the person came from another page in the app, otherwise (shared link, reload) to `href`, the fixed parent.
 */
export function BackLink({ href, label, mode = "parent" }: { href: string; label: string; mode?: "parent" | "back" }) {
  const router = useRouter();
  const full = useHref();
  return (
    <NextLink href={full(href)} className="back-link" data-testid="back"
      onClick={(e) => {
        if (mode !== "back" || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const prev = previousPath();
        // Nowhere to go back to, or the previous page is the parent itself: follow the link (it carries the parent's own state, e.g. a tab).
        if (!prev || prev === full(href).split(/[?#]/)[0]) return;
        e.preventDefault();
        router.back();
      }}>
      ← {mode === "back" ? "Back" : label}
    </NextLink>
  );
}
