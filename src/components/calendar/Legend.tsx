import s from "./calendar.module.css";

const sw = (cls: string, style?: React.CSSProperties) => <i className={`${s.sw} ${cls}`} style={style} aria-hidden />;

export function Legend({ admin }: { admin: boolean }) {
  return (
    <div className={s.legend} data-testid="calendar-legend">
      <span>{sw(s["k-show"])}Show</span>
      <span>{sw(s["k-rehearsal"])}Rehearsal</span>
      {admin && <>
        <span>{sw(s["k-pitchDate"])}Pitch date</span>
        <span>{sw(s["k-deadline"])}Deadline</span>
        <span>{sw(`${s["k-deadline"]} ${s.outl}`)}Est. / pitch by</span>
        <span>{sw(s["k-opens"])}Application opens</span>
        <span>{sw(s["k-seriesStart"])}Series starts</span>
        <span>{sw(s["k-festivalDay"], { background: "var(--accent-soft)" })}Festival days</span>
      </>}
      <span>{sw("", { background: "color-mix(in srgb, #f08c00 18%, var(--panel))", borderColor: "#e8890c" })}Conflict</span>
      <span>{sw("", { background: "var(--accent)", borderRadius: 999 })}Today</span>
    </div>
  );
}
