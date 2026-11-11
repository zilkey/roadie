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
        // Nowhere to go back to, or the previous page is the parent and the link names its state (e.g. ?tab=): follow the link. A
        // bare parent link goes back instead, so a list comes back with its filters (they ride in its URL) and scroll (useListMemory).
        const [path, query] = full(href).split("?");
        if (!prev || (prev === path && query)) return;
        e.preventDefault();
        router.back();
      }}>
      ← {mode === "back" ? "Back" : label}
    </NextLink>
  );
}
