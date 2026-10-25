import type { CalendarItem } from "@/lib/calendar";
import s from "./calendar.module.css";

export const KIND_LABEL: Record<CalendarItem["kind"], string> = {
  show: "Show", rehearsal: "Rehearsal", pitchDate: "Pitch date", opens: "Application opens",
  deadline: "Deadline", seriesStart: "Series starts", festivalDay: "Festival",
};

/** Short label for a desktop chip. */
export function chipText(i: CalendarItem): string {
  if (i.kind === "deadline") return `${i.target ? "Pitch by" : i.estimated ? "Due ~" : "Due"} ${i.title}`;
  if (i.kind === "opens") return `Opens${i.estimated ? " ~" : ""} ${i.title}`;
  return i.title;
}

export function chipClass(i: CalendarItem): string {
  const outl = i.kind === "deadline" && (i.estimated || i.target) ? ` ${s.outl}` : "";
  return `${s.chip} ${s[`k-${i.kind}`]}${outl}${i.kind === "pitchDate" && i.past ? ` ${s.past}` : ""}`;
}

export function dotClass(i: CalendarItem): string {
  const k = i.kind === "show" || i.kind === "rehearsal" || i.kind === "pitchDate" ? i.kind : "edition";
  return `${s.dot} ${s[`d-${k}`]}`;
}
