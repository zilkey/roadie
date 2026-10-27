"use client";
import { useEffect, useState } from "react";
import { useArtist } from "@/lib/artist";
import { runCommand } from "@/lib/commands";

export interface SetupStatus { people: boolean; links: boolean; google: boolean; dismissed: boolean }

/** What is done after starting the band (`artists.setupStatus`); null while it loads or if it fails. Shared by the Ready screen and Home's card. */
export function useSetupStatus() {
  const { artistId } = useArtist();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  useEffect(() => {
    let live = true;
    runCommand<SetupStatus>("artists.setupStatus").then((s) => { if (live) setStatus(s); }, () => {});
    return () => { live = false; };
  }, [artistId]);
  return { status, setStatus };
}
