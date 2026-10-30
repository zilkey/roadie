import Link, { useArtist } from "@/lib/artist";
import { fmtTourDates } from "@/lib/tours";
import { listDays, town, type TourLayer } from "@/lib/calendarTours";
import { actName } from "@/components/tours/common";
import type { Tour } from "@/schema";
import s from "./calendar.module.css";

/** The tour the selected day is on: its dates, act and start, what is booked and open, what needs fixing, and a link to it. */
export function TourPanel({ layer, tour }: { layer: TourLayer; tour: Tour }) {
  const artist = useArtist().doc;
  const meta = [fmtTourDates(tour.startDate, tour.endDate), actName(artist, tour.billedAs), tour.leavingFrom ? `from ${town(tour.leavingFrom)}` : ""].filter(Boolean).join(" · ");
  return (
    <section className={s.card} data-testid="tour-panel">
      <span className={s.kind}>Tour</span>
      <h2>{layer.name}</h2>
      <p className="s">{meta}</p>
      <ul className={s.tourList}>
        <li>{layer.booked} {layer.booked === 1 ? "show" : "shows"} booked</li>
        {layer.openDates.length > 0 && <li>{listDays(layer.openDates.slice(0, 4))}{layer.openDates.length > 4 ? ` and ${layer.openDates.length - 4} more` : ""} still open</li>}
        {layer.warnings.map((w, i) => <li key={i} className={s.tourWarnLine} data-testid="tour-panel-warning">{w.message}</li>)}
      </ul>
      <Link href={`/tours/${layer.id}`} className="btn acc" data-testid="tour-panel-open">Open tour</Link>
    </section>
  );
}
