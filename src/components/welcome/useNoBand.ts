"use client";
import { useEffect, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { ARTISTS_PATH } from "@/lib/routes";

/**
 * Gate for the screens of someone with no band yet (/no-band, /start-band). Returns who they are, or null while
 * loading / when they are somewhere else. Signed-out people go to sign-in; people who do have a band to the picker
 * (unless `staying.current`, set while a just-created band is being opened). A ready session with no live artist counts as no band.
 */
export function useNoBand(staying?: RefObject<boolean>): { email: string; name: string } | null {
  const { state } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "signedOut") router.replace("/signin");
    if (state.status === "notInvited") router.replace("/not-invited");
    if (state.status === "ready" && state.profile.artists.length > 0 && !staying?.current) router.replace(ARTISTS_PATH);
  }, [state, router, staying]);
  if (state.status === "noBand") return { email: state.email, name: state.name };
  if (state.status === "ready" && state.profile.artists.length === 0) return { email: state.profile.email, name: state.profile.name };
  return null;
}
