"use client";
import Link from "@/lib/artist";
import { todayStr } from "@/lib/booking";
import { reviewSeason } from "@/lib/yearReview";
import s from "./banner.module.css";

/** The Calendar's way in to the Year in Review, for admins, from November through January (reviewSeason). */
export function ReviewBanner() {
  const year = reviewSeason(todayStr());
  if (!year) return null;
  return (
    <Link href={`/review?y=${year}`} className={s.banner} data-testid="review-banner">
      <span className={s.spark} aria-hidden>✦</span>
      <span className={s.text}><b>Your {year} in review</b><span>The shows, the songs, the miles and the money.</span></span>
      <span className={s.go}>Play it</span>
    </Link>
  );
}
