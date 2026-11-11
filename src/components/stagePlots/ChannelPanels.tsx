"use client";
import type { StagePlotInput, StagePlotMonitor } from "@/schema/stagePlots";
import { Select } from "@/components/ui";
import { useDragReorder } from "@/lib/drag-reorder";
import { isPlaced } from "@/lib/stagePlots/plot";
import type { InputEdit, MixEdit } from "./useRowEdits";

export type Who = readonly (readonly [string, string])[];
const KINDS = [["wedge", "Wedge"], ["iem", "In-ear"], ["sidefill", "Side fill"]] as const;
const kindLabel = (k: string) => KINDS.find(([v]) => v === k)?.[1] ?? k;
const GRID = "grid grid-cols-2 gap-2 md:grid-cols-[2rem_2.25rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_4.5rem_minmax(0,1fr)_minmax(0,1.4fr)] md:items-center";

interface RowCtl {
  admin: boolean;
  who: Who;
  /** The row to ring (selected circle) and the row being hovered or focused. */
  selected: string | null;
  armed: string | null;
  onHover(id: string | null): void;
  onNumber(id: string, placed: boolean): void;
}

function NumberDot({ n, id, placed, armed, mix, ctl }: { n: number; id: string; placed: boolean; armed: boolean; mix?: boolean; ctl: RowCtl }) {
  return (
    <button type="button" data-testid="row-num" aria-pressed={armed} disabled={!ctl.admin && !placed}
      aria-label={placed ? `${mix ? "Mix" : "Input"} ${n}, on the stage` : `${mix ? "Mix" : "Input"} ${n}, not placed. Press Enter, then tap the stage`}
      title={placed ? "Show on the stage" : "Not placed yet: tap, then tap the stage"}
      onClick={() => ctl.onNumber(id, placed)}
      className={`grid size-9 place-items-center font-mono text-sm font-bold select-none ${mix ? "rounded-md" : "rounded-full"} ${placed ? "bg-accent text-on-accent" : "border-2 border-dashed border-accent bg-surface text-accent"} ${armed ? "ring-4 ring-accent/40" : ""}`}
      style={mix && placed ? { background: "var(--sp-mix, #B07A00)", color: "#fff" } : mix ? { borderColor: "var(--sp-mix, #B07A00)", color: "var(--sp-mix, #B07A00)" } : undefined}>
      {mix ? `M${n}` : n}
    </button>
  );
}

/** The channel list: a row per input. Admins edit in place (autosaved) and drag rows to reorder; members read. */
export function ChannelList({ inputs, edits, onEdit, onReorder, ctl }: {
  inputs: StagePlotInput[]; edits: Record<string, InputEdit>; onEdit(id: string, p: InputEdit, now?: boolean): void; onReorder(order: string[]): void; ctl: RowCtl;
}) {
  const drag = useDragReorder((from, to) => {
    const ids = inputs.map((i) => i.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    onReorder(ids);
  });
  const val = (i: StagePlotInput, k: "source" | "gear" | "stand" | "note" | "musicianId") => edits[i.id]?.[k] ?? i[k] ?? "";
  const phantom = (i: StagePlotInput) => edits[i.id]?.phantom ?? !!i.phantom;
  const whoName = (id: string) => ctl.who.find(([v]) => v === id)?.[1] ?? "";

  if (!inputs.length) return <div className="empty" data-testid="channel-list"><span>No inputs yet. Raise the count above.</span></div>;

  if (!ctl.admin) {
    return (
      <div className="max-w-full overflow-x-auto rounded-xl border border-line bg-surface" data-testid="channel-list">
        <table className="w-full text-left text-sm">
          <thead><tr className="s"><th className="px-3 py-2">Ch</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Mic / DI</th><th className="px-3 py-2">Stand</th><th className="px-3 py-2">48V</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Note</th></tr></thead>
          <tbody>
            {inputs.map((i, k) => (
              <tr key={i.id} className={`border-t border-line ${ctl.selected === i.id ? "bg-accent-soft" : ""}`} data-testid="ch-row" data-ch={k + 1} data-row-id={i.id}
                onMouseEnter={() => ctl.onHover(i.id)} onMouseLeave={() => ctl.onHover(null)}>
                <td className="px-3 py-2 font-mono font-bold">{k + 1}{!isPlaced(i) && <span className="s ml-1 font-sans font-normal">not placed</span>}</td>
                <td className="px-3 py-2">{i.source}</td><td className="px-3 py-2">{i.gear}</td><td className="px-3 py-2">{i.stand}</td>
                <td className="px-3 py-2">{i.phantom ? "48V" : ""}</td><td className="px-3 py-2">{i.musicianId ? whoName(i.musicianId) : ""}</td><td className="px-3 py-2">{i.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="grid gap-2" data-testid="channel-list">
      <div className={`${GRID} s hidden px-2 md:grid`} aria-hidden><span /><span>Ch</span><span>Source</span><span>Mic / DI</span><span>Stand</span><span>48V</span><span>Who</span><span>Note</span></div>
      {inputs.map((i, k) => {
        const n = k + 1;
        const f = (key: "source" | "gear" | "stand" | "note", label: string, tid: string) => (
          <input className="input" aria-label={`${label}, input ${n}`} placeholder={label} value={val(i, key)} data-testid={tid}
            onChange={(e) => onEdit(i.id, { [key]: e.target.value })} onBlur={() => onEdit(i.id, {}, true)} />
        );
        return (
          <div key={i.id} {...drag.row(k)} data-testid="ch-row" data-ch={n} data-row-id={i.id} tabIndex={-1}
            onMouseEnter={() => ctl.onHover(i.id)} onMouseLeave={() => ctl.onHover(null)} onFocus={() => ctl.onHover(i.id)} onBlur={() => ctl.onHover(null)}
            className={`rounded-xl border bg-surface p-2 ${ctl.selected === i.id ? "border-accent bg-accent-soft" : "border-line"}`}>
            <div className={GRID}>
              <span {...drag.handle(k)} data-testid="ch-grip" role="img" aria-label={`Drag to reorder input ${n}`} title="Drag to reorder" className="hidden cursor-grab select-none text-center text-lg leading-none text-muted md:block">⠿</span>
              <div className="flex items-center gap-2 md:contents">
                <span {...drag.handle(k)} className="cursor-grab select-none text-lg leading-none text-muted md:hidden" aria-hidden>⠿</span>
                <NumberDot n={n} id={i.id} placed={isPlaced(i)} armed={ctl.armed === i.id} ctl={ctl} />
              </div>
              {f("source", "Source", "ch-source")}
              {f("gear", "Mic / DI", "ch-gear")}
              {f("stand", "Stand", "ch-stand")}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={phantom(i)} data-testid="ch-phantom" aria-label={`48V, input ${n}`}
                onChange={(e) => onEdit(i.id, { phantom: e.target.checked }, true)} />48V</label>
              <Select value={val(i, "musicianId")} options={ctl.who} placeholder="Who" onChange={(v) => onEdit(i.id, { musicianId: v }, true)} testid="ch-who" label={`Who, input ${n}`} />
              {f("note", "Note", "ch-note")}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const MIX_GRID = "grid grid-cols-2 gap-2 md:grid-cols-[2.5rem_9rem_minmax(0,1fr)_minmax(0,2fr)] md:items-center";

/** Mix rows: kind, who, wants. */
export function MixList({ monitors, edits, onEdit, ctl }: {
  monitors: StagePlotMonitor[]; edits: Record<string, MixEdit>; onEdit(id: string, p: MixEdit, now?: boolean): void; ctl: RowCtl;
}) {
  const whoName = (id: string) => ctl.who.find(([v]) => v === id)?.[1] ?? "";
  if (!monitors.length) return <div className="empty" data-testid="mix-list"><span>No monitor mixes.</span></div>;
  if (!ctl.admin) {
    return (
      <div className="max-w-full overflow-x-auto rounded-xl border border-line bg-surface" data-testid="mix-list">
        <table className="w-full text-left text-sm">
          <thead><tr className="s"><th className="px-3 py-2">Mix</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Wants</th></tr></thead>
          <tbody>
            {monitors.map((m, k) => (
              <tr key={m.id} className={`border-t border-line ${ctl.selected === m.id ? "bg-accent-soft" : ""}`} data-testid="mix-row" data-mix={k + 1} onMouseEnter={() => ctl.onHover(m.id)} onMouseLeave={() => ctl.onHover(null)}>
                <td className="px-3 py-2 font-bold">M{k + 1}</td><td className="px-3 py-2">{kindLabel(m.kind)}</td><td className="px-3 py-2">{m.musicianId ? whoName(m.musicianId) : ""}</td><td className="px-3 py-2">{m.wants}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="grid gap-2" data-testid="mix-list">
      {monitors.map((m, k) => {
        const n = k + 1;
        return (
          <div key={m.id} data-testid="mix-row" data-mix={n} data-row-id={m.id} tabIndex={-1}
            onMouseEnter={() => ctl.onHover(m.id)} onMouseLeave={() => ctl.onHover(null)} onFocus={() => ctl.onHover(m.id)} onBlur={() => ctl.onHover(null)}
            className={`rounded-xl border bg-surface p-2 ${ctl.selected === m.id ? "border-accent bg-accent-soft" : "border-line"}`}>
            <div className={MIX_GRID}>
              <NumberDot n={n} id={m.id} placed={isPlaced(m)} armed={ctl.armed === m.id} mix ctl={ctl} />
              <Select value={edits[m.id]?.kind ?? m.kind} options={KINDS} onChange={(v) => onEdit(m.id, { kind: v }, true)} testid="mix-kind" label={`Kind, mix ${n}`} />
              <Select value={edits[m.id]?.musicianId ?? m.musicianId ?? ""} options={ctl.who} placeholder="Who" onChange={(v) => onEdit(m.id, { musicianId: v }, true)} testid="mix-who" label={`Who, mix ${n}`} />
              <input className="input col-span-2 md:col-span-1" aria-label={`Wants, mix ${n}`} placeholder="Wants (bass, keys, vox)" value={edits[m.id]?.wants ?? m.wants ?? ""} data-testid="mix-wants"
                onChange={(e) => onEdit(m.id, { wants: e.target.value })} onBlur={() => onEdit(m.id, {}, true)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
