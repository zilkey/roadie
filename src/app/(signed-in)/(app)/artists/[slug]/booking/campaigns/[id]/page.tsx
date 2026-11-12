"use client";
import { useParams } from "next/navigation";
import { BookingIndex } from "@/components/booking/BookingIndex";

/** One booking campaign's pitches (#82). */
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <BookingIndex key={id} seg="pitches" campaign={id} />;
}
