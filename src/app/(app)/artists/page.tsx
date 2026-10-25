"use client";
import { Suspense, useEffect } from "react";
import NextLink from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { artistPath, isLegacyPath } from "@/lib/routes";

/**
 * Your artists. With one, you go straight to it; with several, you pick. `?next=/shows/123` (an old link, see
 * src/proxy.ts) opens that page inside the artist.
 */
export default function ArtistsPage() {
  return <Suspense fallback={null}><Picker /></Suspense>;
}

function Picker() {
  const { state, signOut } = useAuth();
  const router = useRouter();
  const raw = useSearchParams().get("next") ?? "";
  const next = isLegacyPath(raw) ? raw : "/calendar";
  const artists = state.status === "ready" ? state.profile.artists : [];
  const only = artists.length === 1 ? artists[0] : null;
  useEffect(() => { if (only) router.replace(artistPath(only.slug, next)); }, [only, next, router]);
  if (state.status !== "ready" || only) return null;

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 px-4 py-10" data-testid="artist-picker">
      <h1 className="page-title">{artists.length ? "Pick a band" : "No band yet"}</h1>
      {artists.length ? (
        <div className="grid gap-2">
          {artists.map((a) => (
            <NextLink key={a.artistId} href={artistPath(a.slug, next)} className="card flex items-center justify-between" data-testid={`artist-${a.slug}`}>
              <b>{a.name}</b><span className={`chip ${a.role === "admin" ? "a" : "m"}`}>{a.role}</span>
            </NextLink>
          ))}
        </div>
      ) : <p>You&apos;re signed in but not in any band. Ask one of its admins to add you.</p>}
      <button className="btn ghost sm w-fit" onClick={signOut}>Sign out</button>
    </main>
  );
}
