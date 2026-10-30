import type { CalendarItem } from "@/lib/calendar";
import s from "./calendar.module.css";
import { chipClass, chipText, dotClass } from "./chips";
import type { TourChip } from "@/lib/calendarTours";

export function DayCell({ date, items, inMonth, today, selected, conflict, festival, tourChips = [], underTour = false, place, onSelect }: {
  date: string; items: CalendarItem[]; inMonth: boolean; today: boolean; selected: boolean; conflict: boolean; festival: boolean;
  /** Tours layer: this day's drive, stay, note, open and warning chips; whether a tour bar sits over it; its explicit grid place (bars are placed explicitly, so cells must be too). */
  tourChips?: TourChip[]; underTour?: boolean; place?: React.CSSProperties;
  onSelect(d: string): void;
}) {
  // A festival's later days are only a shade; they get no chip or dot of their own.
  const shown = items.filter((i) => i.kind !== "festivalDay" || i.firstDay);
  const chips = shown.slice(0, 3);
  const dots = shown.slice(0, 4);
  const cls = [s.cell, !inMonth && s.other, festival && s.fest, conflict && s.conflict, selected && s.sel, today && s.today, underTour && s.underTour].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} aria-label={date} aria-pressed={selected} style={place} data-testid={`day-${date}`} onClick={() => onSelect(date)}>
      <span className={s.num}>{Number(date.slice(8))}</span>
      {conflict && <span className={s.bang} aria-hidden>!</span>}
      <span className={s.chips}>
        {chips.map((i) => <span key={i.id} className={chipClass(i)}>{chipText(i)}</span>)}
        {shown.length > 3 && <span className={s.more}>+{shown.length - 3} more</span>}
        {tourChips.slice(0, 3).map((c) => <span key={c.id} className={`${s.chip} ${s[`k-t${c.kind}`]}`} data-testid="tour-chip" data-kind={c.kind}>{c.text}</span>)}
        {tourChips.length > 3 && <span className={s.more}>+{tourChips.length - 3} more</span>}
      </span>
      <span className={s.dots} aria-hidden>
        {dots.map((i) => <span key={i.id} className={dotClass(i)} />)}
        {shown.length > 4 && <span className={s.more}>+</span>}
      </span>
    </button>
  );
}
