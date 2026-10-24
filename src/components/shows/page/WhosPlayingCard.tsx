"use client";
import { useRef, useState } from "react";
import { PickChip, useCommand } from "@/components/ui";
import { AskWhoIsFree, WhosFree } from "@/components/shows/Availability";
import { billingName, configName, useBand, type ShowRow } from "../common";
import { ASK_LABEL, askState, showName } from "@/lib/shows";
import { EditableCard, UnfinishedPlaceholder, initials, useCardEdit } from "./kit";

const ms = (t?: unknown) => (t as { toMillis?(): number } | undefined)?.toMillis?.() ?? 0;
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Who's playing: billed as, the players with their answer to the ask, and Ask who's free. */
export function WhosPlayingCard({ show, admin }: { show: ShowRow; admin: boolean }) {
  const b = useBand();
  const { call, busy, error } = useCommand();
  const [billedAs, setBilledAs] = useState("");
  const [personnel, setPersonnel] = useState<string[]>([]);
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  const [subOpen, setSubOpen] = useState(false);
  const askRef = useRef<HTMLDivElement>(null);
  const ed = useCardEdit({
    canEdit: admin,
    onStart: () => { setBilledAs(show.billedAs ?? ""); setPersonnel(show.personnel); setFilledFrom(null); setSubOpen(false); },
  });

  const configs = b.artist?.configurations ?? [];
  const asks = b.asks.filter((a) => a.showId === show.id).sort((a, z) => ms(z.createdAt) - ms(a.createdAt));
  const answerOf = (id: string) => {
    const a = asks.find((x) => askState(x, id) !== "notAsked");
    if (!a) return null;
    const st = askState(a, id);
    return st === "yes" ? "✓ Confirmed" : ASK_LABEL[st];
  };
  const nameOf = (id: string) => b.musicians.find((m) => m.id === id)?.name ?? "Someone";

  const billed = show.billedAs
    ? `${billingName(b.artist, show.billedAs) ?? ""}${configName(b.artist, show.billedAs) ? ` (${configName(b.artist, show.billedAs)})` : ""}`
    : null;
  const empty = show.personnel.length === 0;

  const openAsk = () => {
    if (askRef.current?.querySelector('[data-testid="ask-form"]')) return;
    askRef.current?.querySelector<HTMLButtonElement>('[data-testid="ask-toggle"]')?.click();
  };

  const chipIds = [...b.musicians.filter((m) => m.active).map((m) => m.id), ...personnel.filter((id) => !b.musicians.some((m) => m.id === id && m.active))];
  const chips = chipIds.map((id) => ({ id, name: nameOf(id) })).sort((x, y) => x.name.localeCompare(y.name));
  const subs = b.musicians.filter((m) => !m.active && !personnel.includes(m.id)).sort((x, y) => x.name.localeCompare(y.name));

  const pickConfig = (id: string) => {
    setBilledAs(id);
    const c = configs.find((x) => x.id === id);
    if (c) { setPersonnel(c.musicianIds); setFilledFrom(c.name); }
    else setFilledFrom(null);
  };
  const toggle = (id: string) => setPersonnel(personnel.includes(id) ? personnel.filter((x) => x !== id) : [...personnel, id]);

  async function save() {
    const patch: Record<string, unknown> = {};
    const billedChanged = billedAs !== (show.billedAs ?? "");
    if (billedChanged) patch.billedAs = billedAs || null;
    if (billedChanged || !sameList(personnel, show.personnel)) patch.personnel = personnel;
    if (!Object.keys(patch).length) return true;
    return !!(await call("shows.update", { id: show.id, patch }));
  }

  return (
    <EditableCard title="Who’s playing" testid="whos-playing" ed={ed} onSave={save} busy={busy} error={error}
      footLeft={<button type="button" className="btn ghost" onClick={openAsk} data-testid="whos-playing-ask">Ask who&apos;s free</button>}>
      {ed.editing ? (
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <label className="lbl" htmlFor="whos-billed">Billed as</label>
            <select id="whos-billed" className="input select" value={billedAs} onChange={(e) => pickConfig(e.target.value)} data-testid="whos-billed">
              <option value="">Not set</option>
              {configs.map((c) => <option key={c.id} value={c.id}>{c.billingName} ({c.name})</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <span className="lbl" id="whos-players-lbl">Players</span>
            <div role="group" aria-labelledby="whos-players-lbl" className="flex flex-wrap gap-2">
              {chips.map((m) => <PickChip key={m.id} on={personnel.includes(m.id)} onToggle={() => toggle(m.id)} testid={`whos-pick-${m.name}`}>{m.name}</PickChip>)}
              {subs.length > 0 && <button type="button" className="pick" aria-expanded={subOpen} onClick={() => setSubOpen(!subOpen)} data-testid="whos-sub">+ Sub</button>}
            </div>
            {subOpen && subs.length > 0 && (
              <select className="input select" aria-label="Add a sub" value="" onChange={(e) => { if (e.target.value) { setPersonnel([...personnel, e.target.value]); setSubOpen(false); } }} data-testid="whos-sub-select">
                <option value="">Pick a sub</option>
                {subs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
            {filledFrom && <span className="s">Filled in from the {filledFrom} lineup. Tap anyone to change.</span>}
          </div>
        </div>
      ) : (
        <>
          {empty ? (
            <UnfinishedPlaceholder lead="Nobody’s on this show yet." testid="whos-empty"
              actions={admin ? (
                <>
                  <button type="button" className="btn ghost" onClick={ed.start} data-testid="whos-pick-players">Pick players</button>
                  <button type="button" className="btn ghost" onClick={openAsk} data-testid="whos-empty-ask">Ask who&apos;s free</button>
                </>
              ) : undefined}>
              Pick the lineup, or ask the band who’s free that night.
            </UnfinishedPlaceholder>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3" data-testid="whos-players">
              {show.personnel.map((id) => {
                const name = nameOf(id), ans = answerOf(id);
                return (
                  <div key={id} className="flex items-center gap-2.5" data-testid={`whos-player-${name}`}>
                    <span className="avatar" aria-hidden>{initials(name)}</span>
                    <span className="grid"><b>{name}</b>{ans && <span className="s" data-testid={`whos-answer-${name}`}>{ans}</span>}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2.5" data-testid="whos-billed-view">
            <span className="lbl">Billed as</span>
            {billed ? <span>{billed}</span> : <span className="s">Not set</span>}
          </div>
        </>
      )}
      {admin && (
        <div ref={askRef} className={`grid gap-3${ed.editing || empty ? " hide-ask-toggle" : ""}`}>
          {!ed.editing && <WhosFree showId={show.id} musicians={b.musicians} extraIds={show.personnel} />}
          <AskWhoIsFree showId={show.id} date={show.date} defaultIds={show.personnel} place={showName(show)} musicians={b.musicians} />
        </div>
      )}
    </EditableCard>
  );
}
