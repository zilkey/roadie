"use client";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import NextLink from "next/link";
import { useAuth } from "@/lib/auth";
import { ArtistContext, type CurrentArtist } from "@/lib/artist";
import { setCommandArtist } from "@/lib/commands";
import { useDoc } from "@/lib/firestore-hooks";
import { ARTISTS_PATH } from "@/lib/routes";
import { Shell } from "@/components/Shell";
import type { Artist } from "@/schema";

// useLayoutEffect warns during server rendering; the gate only matters in the browser.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Resolves /artists/{slug} to one of the signed-in person's artists and provides it (id, slug, name, your role, the live
 * doc) to everything below. Someone who doesn't belong to that artist is refused here; the server refuses their
 * commands too (`authenticate` checks membership) and Firestore rules only let members read.
 */
export function ArtistGate({ slug, children }: { slug: string; children: React.ReactNode }) {
  const { state, refresh } = useAuth();
  const access = state.status === "ready" ? state.profile.artists.find((a) => a.slug === slug) : undefined;
  // An unknown slug may just be news to us (the artist was renamed, or you were added a moment ago): ask the server once.
  const [rechecked, setRechecked] = useState<string | null>(null);
  const ready = state.status === "ready";
  useEffect(() => {
    if (!ready || access || rechecked === slug) return;
    let alive = true;
    refresh().catch(() => undefined).finally(() => { if (alive) setRechecked(slug); });
    return () => { alive = false; };
  }, [ready, access, rechecked, slug, refresh]);
  const live = useDoc<Artist>("artists", access?.artistId ?? "-");
  // Say which artist server calls are for before any child renders or runs an effect (idempotent, so safe during render);
  // forget it when leaving the artist.
  setCommandArtist(access?.artistId ?? null);
  useIsoLayoutEffect(() => {
    const id = access?.artistId ?? null;
    setCommandArtist(id);
    return () => setCommandArtist(null, id);
  }, [access?.artistId]);
  const value = useMemo<CurrentArtist | null>(() => access
    ? { artistId: access.artistId, slug: access.slug, name: (live.doc?.name as string | undefined) ?? access.name, role: access.role, doc: live.doc }
    : null, [access, live.doc]);

  if (state.status !== "ready") return null;
  if (!value) return rechecked === slug ? <NotAMember slug={slug} /> : null;
  return <ArtistContext.Provider value={value}><Shell>{children}</Shell></ArtistContext.Provider>;
}

function NotAMember({ slug }: { slug: string }) {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 px-4 py-10" data-testid="not-member">
      <h1 className="page-title">Not your band</h1>
      <p>You&apos;re not a member of <b>{slug}</b>, or it doesn&apos;t exist. Ask one of its admins to add you.</p>
      <NextLink href={ARTISTS_PATH} className="btn acc" data-testid="to-my-artists">Go to your artists</NextLink>
    </main>
  );
}
