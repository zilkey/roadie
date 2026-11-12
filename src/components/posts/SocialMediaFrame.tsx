"use client";
import { useArtist } from "@/lib/artist";
import { useDoc } from "@/lib/firestore-hooks";
import { ChecklistSidebar } from "@/components/shows/checklists/ChecklistSidebar";
import type { SocialChecklists } from "@/schema";

/**
 * Every Social Media page (Posts, Photos, a post's editor) inside one frame: the page, with the Social Media checklists beside
 * it. The lists belong to Social Media as a whole, not to a post, so it's the same sidebar on each page; they live in
 * socialChecklists/{artistId}, and no doc yet means no lists. Admins only (the pages are, and so is the doc's read rule).
 * Below xl the sidebar sits under the page so the photo picker keeps its width.
 */
export function SocialMediaFrame({ children }: { children: React.ReactNode }) {
  const { artistId, role } = useArtist();
  const admin = role === "admin";
  const { doc } = useDoc<SocialChecklists>("socialChecklists", artistId, { skip: !admin });
  if (!admin) return <>{children}</>;
  return (
    <div className="social-cols">
      <div className="social-main">{children}</div>
      <aside className="social-side" aria-label="Checklists" data-testid="social-checklists">
        <ChecklistSidebar host={{ kind: "social", id: artistId, artistId, checklists: doc?.checklists ?? [] }} admin />
      </aside>
    </div>
  );
}
