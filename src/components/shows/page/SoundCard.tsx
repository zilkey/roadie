"use client";
import { useRef, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import type { ShowRow } from "../common";
import { AutoGrowTextarea, ShowCard } from "./kit";

type Provider = ShowRow["sound"]["provider"];
const PROVIDER_LABEL: Record<Provider, string> = { venueProvided: "Venue provides", bandProvided: "We bring the PA" };

/**
 * Sound: one card, no edit mode. The toggle saves as soon as it's flipped. Notes: "Add notes" opens a textarea; leaving it
 * (Tab, a click elsewhere) saves and shows the text, and clicking the text edits it again. Escape puts it back. Members read only.
 */
export function SoundCard({ show, admin }: { show: ShowRow; admin: boolean }) {
  const { call, error, busy } = useCommand();
  const saved = show.sound.notes ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  // Escape unmounts the box, which can still fire its blur: that blur must not save.
  const escaped = useRef(false);

  const save = (sound: ShowRow["sound"]) => call("shows.update", { id: show.id, patch: { sound } });
  const withNotes = (provider: Provider, notes: string) => (notes ? { provider, notes } : { provider });
  async function finish() {
    if (draft === null || escaped.current) { escaped.current = false; return; }
    const next = draft.trim();
    setDraft(null);
    if (next !== saved.trim()) await save(withNotes(show.sound.provider, next));
  }

  return (
    <ShowCard title="Sound" testid="sound">
      <div className="seg" role="radiogroup" aria-label="Who's handling sound">
        {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
          <label key={p}>
            <input type="radio" name={`sound-${show.id}`} checked={show.sound.provider === p} disabled={!admin || busy}
              onChange={() => void save(withNotes(p, saved))} data-testid={`sound-${p}`} />
            {PROVIDER_LABEL[p]}
          </label>
        ))}
      </div>
      {draft !== null ? (
        <label className="grid gap-1.5">
          <span className="lbl">Notes</span>
          <AutoGrowTextarea autoFocus value={draft} onChange={setDraft} onBlur={() => void finish()} data-testid="sound-notes"
            onKeyDown={(e) => { if (e.key === "Escape") { escaped.current = true; setDraft(null); } }} />
        </label>
      ) : saved.trim() ? (
        admin
          ? <button type="button" className="cursor-text rounded-lg text-left text-[15px] leading-relaxed whitespace-pre-line hover:bg-[var(--divider)]"
              aria-label="Edit sound notes" onClick={() => { escaped.current = false; setDraft(saved); }} data-testid="sound-notes-view">{saved}</button>
          : <p className="m-0 whitespace-pre-line text-[15px] leading-relaxed" data-testid="sound-notes-view">{saved}</p>
      ) : admin && (
        <div><button type="button" className="btn ghost" onClick={() => { escaped.current = false; setDraft(""); }} data-testid="sound-add-notes">Add notes</button></div>
      )}
      <ErrorBox error={error} />
    </ShowCard>
  );
}
