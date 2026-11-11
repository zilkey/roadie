import { conflictOf, monthGrid, type CalendarItem } from "@/lib/calendar";
import { barSegments, onTour, type TourLayer } from "@/lib/calendarTours";
import s from "./calendar.module.css";
import { DayCell } from "./DayCell";
import { TourBar } from "./TourBar";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthGrid({ ym, allByDay, shownByDay, today, selected, tours = [], onSelect }: {
  ym: string; allByDay: Map<string, CalendarItem[]>; shownByDay: Map<string, CalendarItem[]>; today: string; selected: string;
  /** Tours layer (empty when it is off): the grid then looks exactly as it did. */
  tours?: TourLayer[];
  onSelect(d: string): void;
}) {
  const grid = monthGrid(ym);
  const segs = tours.flatMap((l) => barSegments(grid, l));
  return (
    <div className={s.grid} data-testid="calendar-grid">
      {DOW.map((d) => <div key={d} className={s.dow}>{d}</div>)}
      {grid.map((d, i) => (
        <DayCell key={d} date={d} inMonth={d.startsWith(ym)} today={d === today} selected={d === selected}
          items={shownByDay.get(d) ?? []}
          // Conflicts and festival shading always use the unfiltered day.
          conflict={!!conflictOf(allByDay.get(d) ?? [])}
          festival={(allByDay.get(d) ?? []).some((i) => i.kind === "festivalDay")}
          tourChips={tours.flatMap((l) => l.chips.get(d) ?? [])} underTour={tours.some((l) => onTour(l, d))}
          place={segs.length ? { gridRow: Math.floor(i / 7) + 2, gridColumn: (i % 7) + 1 } : undefined}
          onSelect={onSelect} />
      ))}
      {segs.map((seg, i) => <TourBar key={`${seg.tourId}:${seg.row}:${i}`} seg={seg} />)}
    </div>
  );
}
