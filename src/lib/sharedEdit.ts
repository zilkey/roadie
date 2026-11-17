"use client";
import { useProfile } from "@/lib/auth";

/** The bits of a shared directory record (venue, act, promoter, festival, edition) that decide who may change it. */
export interface SharedOwned { createdBy?: string; adoptedAt?: unknown }

/**
 * May the signed-in person change this shared record? The same rule the server's Writer enforces (src/server/platform.ts):
 * an approved shared editor, a platform admin, or the person who created it until an approved editor adopts it.
 * Everyone else sees "Ask to edit"; their own notes stay editable.
 */
export function useCanEditShared(rec: SharedOwned | null | undefined): boolean {
  const p = useProfile();
  if (p.sharedEditor || p.platformAdmin) return true;
  return !!rec && rec.createdBy === p.uid && !rec.adoptedAt;
}

/** Platform admins merge and remove shared entries (venues, venue types, festivals, promoters, editions). */
export function usePlatformAdmin(): boolean {
  return !!useProfile().platformAdmin;
}
