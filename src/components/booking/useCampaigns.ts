"use client";
import { useMemo } from "react";
import { useCollection } from "@/lib/firestore-hooks";
import { useArtist } from "@/lib/artist";
import { liveCampaigns, sortCampaigns } from "@/lib/campaigns";
import type { Campaign } from "@/schema";

/** The band's live campaigns, admins only (#82): by id, and active / closed by name. */
export function useCampaigns() {
  const { artistId, role } = useArtist();
  const c = useCollection<Campaign>("campaigns", { where: [["artistId", "==", artistId]], skip: role !== "admin" });
  const live = useMemo(() => liveCampaigns(c.rows ?? []), [c.rows]);
  const sorted = useMemo(() => sortCampaigns(live.values()), [live]);
  return { live, ...sorted, loading: c.loading };
}
