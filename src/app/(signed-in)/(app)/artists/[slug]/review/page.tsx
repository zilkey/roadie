"use client";
import { Suspense } from "react";
import { AdminOnly } from "@/components/Guard";
import { YearReview } from "@/components/review/YearReview";

/** Year in Review: full-screen story slides of the band's year. Admins only (it shows money). No app shell on this route (Shell skips /review). */
export default function Page() {
  return <AdminOnly><Suspense fallback={null}><YearReview /></Suspense></AdminOnly>;
}
