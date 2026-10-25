import Link from "@/lib/artist";
import { daysUntil, type CalendarItem } from "@/lib/calendar";
import { fmtPitchDate } from "@/lib/booking";
import s from "./calendar.module.css";
import { KIND_LABEL, chipClass } from "./chips";

export function ComingUp({ items, today }: { items: CalendarItem[]; today: string }) {
  return (
    <section className={s.card} data-testid="coming-up">
      <h2>Coming up</h2>
      {items.length === 0 ? <p className="s">Nothing coming up.</p> : items.map((i) => {
        const n = daysUntil(i.date, today);
        return (
          <Link key={i.id} href={i.href} className={s.row}>
            <span className="s">{fmtPitchDate(i.date)}</span>
            <span style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{i.title}</span>
            <span className={chipClass(i)}>{KIND_LABEL[i.kind]}</span>
            <span className="s" style={{ gridColumn: "1 / -1" }}>{n === 0 ? "today" : `in ${n} day${n === 1 ? "" : "s"}`}</span>
          </Link>
        );
      })}
    </section>
  );
}
