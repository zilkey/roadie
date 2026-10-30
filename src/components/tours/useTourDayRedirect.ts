"use client";
import { useEffect, useRef } from "react";
import { useArtistRouter } from "@/lib/artist";
import { useProfile } from "@/lib/auth";
import { useCollection } from "@/lib/firestore-hooks";
import { previousPath } from "@/lib/navHistory";
import { todayStr } from "@/lib/booking";
import { tourToday } from "@/lib/tours";
import type { Tour } from "@/schema";

/**
 * On a tour day, a member opening the app sees that day's sheet first: called from the calendar, it sends a member who has just
 * landed (no earlier in-app page) to /tours/{id}/day/{today} when a tour under way has them in it. Once per day per session
 * (sessionStorage), so going back to the calendar from the sheet stays put. Admins are never sent.
 */
export function useTourDayRedirect() {
  const profile = useProfile();
  const router = useArtistRouter();
  const admin = profile.role === "admin";
  const landed = useRef(previousPath() === undefined); // the first page of this visit
  const tours = useCollection<Tour>("tours", { skip: admin || !landed.current }).rows;
  useEffect(() => {
    if (admin || !landed.current || !tours) return;
    const today = todayStr();
    const tour = tourToday(tours, today, profile.musicianId);
    if (!tour) return;
    const key = `tourDayRedirect:${today}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* no storage: still go once per mount */ }
    landed.current = false;
    router.replace(`/tours/${tour.id}/day/${today}`);
  }, [admin, tours, profile.musicianId, router]);
}
