"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useArtistRouter, useMaybeArtist } from "@/lib/artist";
import { ARTISTS_PATH } from "@/lib/routes";

/** Signed-in gate for the app shell: sends everyone else to sign-in (which comes back here after) / not-invited. */
export function SignedIn({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "signedOut") {
      const here = location.pathname + location.search + location.hash;
      router.replace(location.pathname === ARTISTS_PATH ? "/signin" : `/signin?next=${encodeURIComponent(here)}`);
    }
    if (state.status === "notInvited") router.replace("/not-invited");
  }, [state.status, router]);
  if (state.status !== "ready") return <div className="grid min-h-dvh place-items-center s" data-testid="auth-loading">Loading…</div>;
  return <>{children}</>;
}

/** Page-level role gate: admins of the current artist only. Everyone else goes back to the artist's Calendar. */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const artist = useMaybeArtist();
  const router = useArtistRouter();
  const ok = artist?.role === "admin";
  useEffect(() => { if (artist && !ok) router.replace("/calendar"); }, [artist, ok, router]);
  return ok ? <>{children}</> : null;
}
