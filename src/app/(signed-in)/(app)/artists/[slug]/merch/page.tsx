"use client";
import { useEffect } from "react";
import { useArtistRouter } from "@/lib/artist";

/** The Merch page became the Fan Page's Price list tab. */
export default function Page() {
  const router = useArtistRouter();
  useEffect(() => { router.replace("/fans?tab=price"); }, [router]);
  return null;
}
