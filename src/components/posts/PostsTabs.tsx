"use client";
import Link from "@/lib/artist";

/** Posts' two tabs, each its own page: the posts (drafts first) and the Socials inbox's photos. */
export function PostsTabs({ at }: { at: "posts" | "photos" }) {
  const tabs: ["posts" | "photos", string, string][] = [["posts", "Posts", "/posts"], ["photos", "Photos", "/posts/photos"]];
  return (
    <nav className="tabs" aria-label="Posts" data-testid="posts-tab">
      {tabs.map(([k, label, href]) => (
        <Link key={k} href={href} role="tab" aria-selected={at === k} aria-current={at === k ? "page" : undefined} className="no-underline" data-testid={`posts-tab-${k}`}>{label}</Link>
      ))}
    </nav>
  );
}
