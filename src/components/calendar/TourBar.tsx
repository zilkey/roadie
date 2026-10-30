import Link from "@/lib/artist";
import type { TourBarSeg } from "@/lib/calendarTours";
import s from "./calendar.module.css";

/** One tour's bar across the days it covers in one week row; links to the tour. The first row carries the label and "n to fix". */
export function TourBar({ seg }: { seg: TourBarSeg }) {
  const cls = [s.tourBar, seg.contFrom && s.contFrom, seg.contTo && s.contTo].filter(Boolean).join(" ");
  return (
    <Link href={`/tours/${seg.tourId}`} className={cls} style={{ gridRow: seg.row + 2, gridColumn: `${seg.col} / ${seg.end + 1}` }}
      data-testid={seg.first ? `tour-bar-${seg.tourId}` : `tour-bar-${seg.tourId}-cont`}>
      <span className={s.tourText}>{seg.text}</span>
      {seg.fix > 0 && <span className={s.tourFix} data-testid="tour-bar-fix">{seg.fix} to fix</span>}
    </Link>
  );
}
