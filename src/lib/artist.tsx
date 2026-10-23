"use client";
import { createContext, useContext, useMemo } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import type { Artist } from "@/schema";
import type { Row } from "./firestore-hooks";
import { artistPath, isLegacyPath } from "./routes";

/** The artist the open page belongs to: from the URL (/artists/{slug}/...) and the signed-in person's membership. */
export interface CurrentArtist {
  artistId: string;
  slug: string;
  name: string;
  /** Your role in this artist. */
  role: "admin" | "member";
  /** The live artists/{id} document (null while loading). */
  doc: Row<Artist> | null;
}

export const ArtistContext = createContext<CurrentArtist | null>(null);

/** The artist you're working in. Only inside /artists/[slug]. */
export function useArtist(): CurrentArtist {
  const a = useContext(ArtistContext);
  if (!a) throw new Error("useArtist outside an artist");
  return a;
}
export const useMaybeArtist = () => useContext(ArtistContext);

/**
 * Band pages write their links artist-relative ("/shows/1", "/booking"). Inside an artist these become
 * "/artists/{slug}/shows/1"; anything else (already full, /signin, /api, query-only) is left alone.
 */
export function toArtistHref(slug: string | undefined, href: string): string {
  return slug && isLegacyPath(href) ? artistPath(slug, href) : href;
}

/** `useHref()("/shows/1")` -> "/artists/{slug}/shows/1" for the current artist. */
export function useHref() {
  const slug = useContext(ArtistContext)?.slug;
  return useMemo(() => (href: string) => toArtistHref(slug, href), [slug]);
}

/** next/navigation's router, but artist-relative paths stay inside the current artist. */
export function useArtistRouter() {
  const router = useRouter();
  const href = useHref();
  return useMemo(() => ({
    ...router,
    push: (to: string, opts?: Parameters<typeof router.push>[1]) => router.push(href(to), opts),
    replace: (to: string, opts?: Parameters<typeof router.replace>[1]) => router.replace(href(to), opts),
    prefetch: (to: string, opts?: Parameters<typeof router.prefetch>[1]) => router.prefetch(href(to), opts),
  }), [router, href]);
}

/** next/link for band pages: an artist-relative string `href` is put inside the current artist. */
export function Link(props: React.ComponentProps<typeof NextLink>) {
  const href = useHref();
  return <NextLink {...props} href={typeof props.href === "string" ? href(props.href) : props.href} />;
}
export default Link;
