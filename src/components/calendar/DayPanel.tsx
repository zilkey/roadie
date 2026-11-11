import Link from "@/lib/artist";
import { conflictOf, type CalendarItem } from "@/lib/calendar";
import s from "./calendar.module.css";
import { KIND_LABEL } from "./chips";

const longDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export function DayPanel({ date, allItems, items }: { date: string; allItems: CalendarItem[]; items: CalendarItem[] }) {
  const conflict = conflictOf(allItems);
  return (
    <section className={s.card} data-testid="day-panel">
      <h2>{longDate(date)}</h2>
      {conflict && <div className={s.banner} data-testid="conflict-banner">{conflict.label}</div>}
      {items.length === 0 ? <p className="s">Nothing on this day.</p> : items.map((i) => (
        <Link key={i.id} href={i.href} className={s.item}>
          <span className={s.kind}>{KIND_LABEL[i.kind]}{i.kind === "deadline" ? (i.target ? " · pitch by" : i.estimated ? " · est." : "") : i.kind === "opens" && i.estimated ? " · est." : i.kind === "nextStep" && i.past ? " · overdue" : ""}</span>
          <span className={`${s.name} ${i.kind === "pitchDate" && i.past ? s.past : ""}`} style={{ fontWeight: 700 }}>{i.title}</span>
          {i.subtitle && <span className="s">{i.subtitle}</span>}
        </Link>
      ))}
    </section>
  );
}
