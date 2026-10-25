"use client";
import Link from "@/lib/artist";
import { useBooking } from "./common";
import { STATUSES, STATUS_LABEL } from "@/lib/booking";

/** Admin Home: the Pitch List summary (status counts, linking to Booking). */
export function BookingHome() {
  const b = useBooking();
  const counts = STATUSES.map((s) => [s, b.pitches.filter((p) => p.status === s).length] as const).filter(([, n]) => n > 0);
  return (
    <div className="grid gap-5" data-testid="booking-home">
      <div className="card" data-testid="pitch-summary">
        <div className="flex items-center justify-between"><span className="lbl">Pitch List</span><Link href="/booking" className="s font-semibold underline">Open</Link></div>
        <div className="flex flex-wrap gap-1.5">
          {counts.length === 0 && <span className="s">Empty. Tap a flag in Booking to start.</span>}
          {counts.map(([s, n]) => <span key={s} className="chip">{STATUS_LABEL[s]} {n}</span>)}
        </div>
      </div>
    </div>
  );
}
