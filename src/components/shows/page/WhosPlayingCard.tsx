"use client";
import { useRef, useState } from "react";
import { ErrorBox, PickChip, useCommand } from "@/components/ui";
import { InlineValue } from "@/components/InlineValue";
import { AskWhoIsFree, WhosFree } from "@/components/shows/Availability";
import { fmtInstant } from "@/lib/timezone";
import { useBand, type ShowRow } from "../common";
import { askState, showName, type AskState } from "@/lib/shows";
import { ShowCard, UnfinishedPlaceholder, initials } from "./kit";

const ms = (t?: unknown) => (t as { toMillis?(): number } | undefined)?.toMillis?.() ?? 0;
const names = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const SAID: Record<"yes" | "maybe" | "no" | "waiting", (who: string[]) => string> = {
  yes: (w) => `${names(w)} said yes`,
  maybe: (w) => `${names(w)} said maybe`,
  no: (w) => `${names(w)} said no`,
  waiting: (w) => `${names(w)} ${w.length === 1 ? "hasn’t" : "haven’t"} answered`,
};

/**
 * Who's playing, with no flip: a chip per musician that saves on tap, Billed as as a value (picking a lineup lets the server
 * fill in the players), and Ask who's free in the header. Members see the avatar + name list.
 */
export function WhosPlayingCard({ show, admin }: { show: ShowRow; admin: boolean }) {
  const b = useBand();
  const players = useCommand();
  const billed = useCommand();
  // Optimistic chips: the list we sent, until the show's own list changes (or the call fails).
  const [sent, setSent] = useState<string[] | null>(null);
  const [seen, setSeen] = useState(show.personnel);
  if (seen !== show.personnel) { setSeen(show.personnel); setSent(null); }
  const personnel = sent ?? show.personnel;
  const [subOpen, setSubOpen] = useState(false);
  const askRef = useRef<HTMLDivElement>(null);

  const configs = b.artist?.configurations ?? [];
  const billedOptions: [string, string][] = [["", "Not set"], ...configs.map((c): [string, string] => [c.id, `${c.billingName} (${c.name})`])];
  const asks = b.asks.filter((a) => a.showId === show.id).sort((a, z) => ms(z.createdAt) - ms(a.createdAt));
  const stateOf = (id: string): AskState => {
    const a = asks.find((x) => askState(x, id) !== "notAsked");
    return a ? askState(a, id) : "notAsked";
  };
  const nameOf = (id: string) => b.musicians.find((m) => m.id === id)?.name ?? "Someone";
  const empty = personnel.length === 0;

  // The header button stands in for AskWhoIsFree's own toggle (hidden here): it opens the form, and closes it again.
  const openAsk = () => askRef.current?.querySelector<HTMLButtonElement>('[data-testid="ask-toggle"]')?.click();

  const chipIds = [...b.musicians.filter((m) => m.active).map((m) => m.id), ...personnel.filter((id) => !b.musicians.some((m) => m.id === id && m.active))];
  const chips = chipIds.map((id) => ({ id, name: nameOf(id) })).sort((x, y) => x.name.localeCompare(y.name));
  const subs = b.musicians.filter((m) => !m.active && !personnel.includes(m.id)).sort((x, y) => x.name.localeCompare(y.name));

  async function setPlayers(next: string[]) {
    setSent(next);
    if (!(await players.call("shows.update", { id: show.id, patch: { personnel: next } }))) setSent(null);
  }
  const toggle = (id: string) => void setPlayers(personnel.includes(id) ? personnel.filter((x) => x !== id) : [...personnel, id]);

  // "Asked Oct 20 · Ingrid and Jeff said yes · Emma hasn't answered": each person's latest answer to the asks on this show.
  const groups = new Map<AskState, string[]>();
  for (const m of chips) {
    const st = stateOf(m.id);
    if (st !== "notAsked") groups.set(st, [...(groups.get(st) ?? []), m.name]);
  }
  const answers = asks.length > 0 && groups.size > 0
    ? [`Asked ${fmtInstant(ms(asks[0].createdAt), { month: "short", day: "numeric" })}`,
      ...(["yes", "maybe", "no", "waiting"] as const).filter((s) => groups.has(s)).map((s) => SAID[s](groups.get(s)!))].join(" · ")
    : null;

  return (
    <ShowCard title="Who’s playing" testid="whos-playing"
      aside={admin ? <button type="button" className="btn ghost" onClick={openAsk} data-testid="whos-playing-ask">Ask who&apos;s free</button> : undefined}>
      {empty && (
        <UnfinishedPlaceholder lead="Nobody’s on this show yet." testid="whos-empty">
          {admin ? "Tap the people playing, or pick a lineup to fill them in." : undefined}
        </UnfinishedPlaceholder>
      )}
      {admin ? (
        <div className="grid gap-1.5">
          <div role="group" aria-label="Players" className="flex flex-wrap gap-2" data-testid="whos-players">
            {chips.map((m) => <PickChip key={m.id} on={personnel.includes(m.id)} onToggle={() => toggle(m.id)} testid={`whos-pick-${m.name}`}>{m.name}</PickChip>)}
            {subs.length > 0 && <button type="button" className="pick" aria-expanded={subOpen} onClick={() => setSubOpen(!subOpen)} data-testid="whos-sub">+ Sub</button>}
          </div>
          {subOpen && subs.length > 0 && (
            <select className="input select" aria-label="Add a sub" value="" data-testid="whos-sub-select"
              onChange={(e) => { if (e.target.value) { void setPlayers([...personnel, e.target.value]); setSubOpen(false); } }}>
              <option value="">Pick a sub</option>
              {subs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          <ErrorBox error={players.error} />
        </div>
      ) : !empty && (
        <div className="grid gap-3 sm:grid-cols-3" data-testid="whos-players">
          {personnel.map((id) => {
            const name = nameOf(id);
            return (
              <div key={id} className="flex items-center gap-2.5" data-testid={`whos-player-${name}`}>
                <span className="avatar" aria-hidden>{initials(name)}</span>
                <b>{name}</b>
              </div>
            );
          })}
        </div>
      )}
      {answers && <span className="s" data-testid="whos-answers">{answers}</span>}
      {admin ? (
        <div ref={askRef} className="grid gap-3 hide-ask-toggle">
          <WhosFree showId={show.id} musicians={b.musicians} extraIds={show.personnel} />
          <AskWhoIsFree showId={show.id} date={show.date} defaultIds={show.personnel} place={showName(show)} musicians={b.musicians} />
        </div>
      ) : <WhosFree showId={show.id} musicians={b.musicians} extraIds={show.personnel} />}
      <div className="grid gap-1" data-testid="whos-billed-view">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="lbl">Billed as</span>
          {/* Sent without `personnel`: the server fills the players from the lineup. */}
          <InlineValue testid="whos-billed" label="Billed as" kind="select" value={show.billedAs ?? ""} options={billedOptions} canEdit={admin}
            error={billed.error} onSave={async (v) => !!(await billed.call("shows.update", { id: show.id, patch: { billedAs: v || null } }))} />
        </div>
        {admin && <span className="s">Picking a lineup fills in the players. Tap anyone to change.</span>}
      </div>
    </ShowCard>
  );
}
