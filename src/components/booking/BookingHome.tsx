"use client";
import Link from "@/lib/artist";
import { useBooking, StatusChip, hrefFor } from "./common";
import { STATUSES, STATUS_LABEL, fmtDate, todayStr, upcomingDeadlines } from "@/lib/booking";

/** Admin Home: to-dos from pitch next steps, application deadlines, and the Pitch List. Show-day logic lives in slice 4. */
export function BookingHome() {
  const b = useBooking();
  const today = todayStr();
  const live = b.pitches.filter((p) => p.status !== "declined" && p.status !== "dropped" && p.status !== "booked");
  const todos = live.filter((p) => p.nextStep).sort((x, y) => x.nextStep!.due.localeCompare(y.nextStep!.due));
  const deadlines = upcomingDeadlines(b.editions, today, 120);
  const counts = STATUSES.map((s) => [s, b.pitches.filter((p) => p.status === s).length] as const).filter(([, n]) => n > 0);
  return (
    <div className="grid gap-5" data-testid="booking-home">
      <div className="grid gap-3" data-testid="todos">
        <span className="lbl">To-dos</span>
        {todos.length === 0 && <div className="empty"><span>Nothing due.</span></div>}
        {todos.map((p) => {
          const overdue = p.nextStep!.due < today, due = p.nextStep!.due === today;
          return (
            <Link key={p.id} href={`/booking/pitches/${p.id}`} className={`card ${due || overdue ? "hi" : ""}`} data-testid={`todo-${p.id}`}>
              <div className="flex items-center justify-between gap-2"><b>{p.nextStep!.text} · {p.target.name}</b><span className={`chip ${overdue ? "a" : ""}`}>{overdue ? "Overdue" : due ? "Today" : fmtDate(p.nextStep!.due)}</span></div>
            </Link>
          );
        })}
      </div>
      <div className="grid gap-3" data-testid="deadlines">
        <span className="lbl">Application deadlines</span>
        {deadlines.length === 0 && <div className="empty"><span>None in the next few months.</span></div>}
        {deadlines.map((e) => {
          const pitch = b.pitches.find((p) => p.target.kind === "edition" && p.target.id === e.id);
          return (
            <Link key={e.id} href={hrefFor("edition", e.id)} className="card" data-testid={`deadline-${e.id}`}>
              <div className="flex items-center justify-between gap-2"><b>{e.festivalName} {e.label}</b><span className="chip">{fmtDate(e.appDeadline!.date)}</span></div>
              <span className="s">{pitch ? <>On the Pitch List · <StatusChip status={pitch.status} /></> : "Not on the Pitch List yet"}</span>
            </Link>
          );
        })}
      </div>
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
