import type { CalendarItem } from "@/lib/calendar";
import s from "./calendar.module.css";
import { chipClass, chipText, dotClass } from "./chips";

export function DayCell({ date, items, inMonth, today, selected, conflict, festival, onSelect }: {
  date: string; items: CalendarItem[]; inMonth: boolean; today: boolean; selected: boolean; conflict: boolean; festival: boolean;
  onSelect(d: string): void;
}) {
  // A festival's later days are only a shade; they get no chip or dot of their own.
  const shown = items.filter((i) => i.kind !== "festivalDay" || i.firstDay);
  const chips = shown.slice(0, 3);
  const dots = shown.slice(0, 4);
  const cls = [s.cell, !inMonth && s.other, festival && s.fest, conflict && s.conflict, selected && s.sel, today && s.today].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} aria-label={date} aria-pressed={selected} data-testid={`day-${date}`} onClick={() => onSelect(date)}>
      <span className={s.num}>{Number(date.slice(8))}</span>
      {conflict && <span className={s.bang} aria-hidden>!</span>}
      <span className={s.chips}>
        {chips.map((i) => <span key={i.id} className={chipClass(i)}>{chipText(i)}</span>)}
        {shown.length > 3 && <span className={s.more}>+{shown.length - 3} more</span>}
      </span>
      <span className={s.dots} aria-hidden>
        {dots.map((i) => <span key={i.id} className={dotClass(i)} />)}
        {shown.length > 4 && <span className={s.more}>+</span>}
      </span>
    </button>
  );
}
