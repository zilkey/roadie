"use client";
import { BookingIndex } from "@/components/booking/BookingIndex";
import { ONGOING } from "@/lib/campaigns";

/** Ongoing: every pitch with no campaign, and the active ones whose campaign is closed (#82). */
export default function Page() { return <BookingIndex seg="pitches" campaign={ONGOING} />; }
