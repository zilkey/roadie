"use client";
import { useId, useState } from "react";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { CloseIcon } from "@/components/Sheet";
import { useCollection } from "@/lib/firestore-hooks";
import type { SetlistTemplate } from "@/schema";

/** "Import from setlist" on a rehearsal: copies a setlist's songs (breaks skipped) into the rehearsal's list, appended or replacing it. */
export default function ImportSetlistDialog({ rehearsalId, songCount }: { rehearsalId: string; songCount: number }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className="btn ghost" data-testid="reh-import-setlist" onClick={() => setOpen(true)}>Import from setlist</button>
      <Dialog open={open} onClose={close} title="Import songs from a setlist" testid="imp-dialog">
        <ImportForm rehearsalId={rehearsalId} songCount={songCount} close={close} />
      </Dialog>
    </>
  );
}

const plural = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;

/** Mounts each time the dialog opens (Dialog renders its children only while open), so the picks start fresh every time. */
function ImportForm({ rehearsalId, songCount, close }: { rehearsalId: string; songCount: number; close(): void }) {
  const setlists = useCollection<SetlistTemplate>("setlistTemplates");
  const { call, error, busy } = useCommand();
  const radioName = useId();
  const [pick, setPick] = useState<string | null>(null);
  // Per item index in the chosen setlist: false = unticked. Every song starts ticked. Cleared when the setlist changes.
  const [on, setOn] = useState<Record<number, boolean>>({});
  const [mode, setMode] = useState<"append" | "replace">("append");

  const all = [...(setlists.rows ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const chosen = all.find((s) => s.id === pick) ?? all[0];
  const songs = (chosen?.items ?? []).flatMap((it, i) => (it.type === "song" && it.songId ? [{ i, songId: it.songId, title: it.title, note: it.note }] : []));
  const ticked = songs.filter((s) => on[s.i] !== false);

  function changeSetlist(id: string) {
    setPick(id);
    setOn({});
  }
  function toggle(i: number) {
    setOn((o) => ({ ...o, [i]: o[i] === false }));
  }

  async function importNow() {
    if (!chosen || ticked.length === 0) return;
    const r = await call("rehearsals.importSetlist", { id: rehearsalId, setlistId: chosen.id, songIds: ticked.map((s) => s.songId), mode });
    if (r) close();
  }

  return (
    <>
      <div className="flex justify-end">
        <button type="button" className="icon-btn" aria-label="Close" data-testid="imp-close" onClick={close}><CloseIcon /></button>
      </div>

      {setlists.rows === null ? (
        <span className="s">Loading…</span>
      ) : all.length === 0 ? (
        <span className="s">No setlist templates yet.</span>
      ) : (
        <label className="grid gap-1">
          <span className="lbl">Setlist</span>
          <select className="select" value={chosen?.id ?? ""} onChange={(e) => changeSetlist(e.target.value)} data-testid="imp-setlist">
            {all.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}

      <fieldset className="grid gap-0 rounded-[10px] border border-line px-3.5 py-1">
        <legend className="lbl px-1">Songs to bring in</legend>
        {chosen && songs.length === 0 && <span className="s py-2">This setlist has no songs.</span>}
        {songs.map((s) => (
          <label key={s.i} className="flex min-h-11 items-center gap-3 border-b border-line text-sm last:border-b-0" data-testid="imp-song">
            <input type="checkbox" checked={on[s.i] !== false} onChange={() => toggle(s.i)} />
            <span className="min-w-0 grow truncate">{s.title}</span>
            {s.note && <span className="shrink-0 text-xs text-muted">{s.note}</span>}
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-1.5">
        <legend className="lbl">This rehearsal already has {plural(songCount)}</legend>
        <div className="flex flex-wrap gap-5">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name={radioName} checked={mode === "append"} onChange={() => setMode("append")} data-testid="imp-mode-append" />
            Add to end
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name={radioName} checked={mode === "replace"} onChange={() => setMode("replace")} data-testid="imp-mode-replace" />
            Replace list
          </label>
        </div>
      </fieldset>

      <ErrorBox error={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn ghost" data-testid="imp-cancel" onClick={close}>Cancel</button>
        <button type="button" className="btn acc" data-testid="imp-confirm" disabled={busy || ticked.length === 0} onClick={importNow}>
          Add {plural(ticked.length)}
        </button>
      </div>
    </>
  );
}
