"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { CloseIcon } from "@/components/Sheet";
import { Menu, type MenuItem } from "@/components/Menu";
import { SaveStatus } from "@/components/SaveStatus";
import type { SaveState } from "@/lib/autosave";
import { fmtDay, useMusic } from "@/components/music/common";
import { SetlistItemsEditor, itemsPayload, type SetlistItemT } from "@/components/music/SetlistItemsEditor";
import { runCommand } from "@/lib/commands";
import { setLengthOf } from "@/lib/duration";
import { fmtLen, setlistSlack } from "@/lib/music";
import { showName } from "@/lib/shows";
import type { ShowRow } from "../common";

type From = { kind: "template" | "show"; id: string };
const plural = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;
const songCount = (items: SetlistItemT[]) => items.filter((i) => i.type === "song").length;

/**
 * The show's Setlist tab: the show's own setlist (setlists/{showId}), edited in place and autosaved through setlists.setItems,
 * plus the two ways to start one: seed from a template, or copy from another show's setlist.
 * setlists.setItems takes { showId, items } rather than { id, patch }, so this doesn't use useAutosave: a small serial queue
 * sends the latest list (one request at a time) and feeds the same SaveStatus label.
 */
export function SetlistTab({ show, admin }: { show: ShowRow; admin: boolean }) {
  const m = useMusic();
  const { call, error, busy } = useCommand();
  const sl = m.setlists.find((s) => s.id === show.id);
  const serverItems = sl?.items;
  const serverKey = JSON.stringify(serverItems ?? []);
  const [items, setItems] = useState<SetlistItemT[]>(serverItems ?? []);
  useEffect(() => { setItems(serverItems ?? []); }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [status, setStatus] = useState<SaveState>("idle");
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const next = useRef<SetlistItemT[] | null>(null);
  const running = useRef(false);
  async function drain() {
    if (running.current) return;
    running.current = true;
    try {
      while (next.current) {
        const list = next.current; next.current = null;
        setStatus("saving"); setSaveErr(null);
        try { await runCommand("setlists.setItems", { showId: show.id, items: itemsPayload(list) }); setStatus(next.current ? "saving" : "saved"); }
        catch (e) { setSaveErr((e as Error).message); setStatus("error"); next.current = null; }
      }
    } finally { running.current = false; }
  }
  const save = (list: SetlistItemT[]) => { setItems(list); next.current = list; void drain(); };

  const total = items.reduce((n, i) => n + (i.lengthSec ?? 0), 0);
  const setLen = setLengthOf(show.times);
  const slack = setlistSlack(total, setLen);
  const over = slack != null && slack < 0;

  // Seed: with something already on the list, ask append or replace first; on an empty list just replace.
  const [pending, setPending] = useState<{ from: From; label: string } | null>(null);
  async function seed(from: From, mode: "append" | "replace") {
    setStatus("saving"); setSaveErr(null);
    const r = await call("setlists.seed", { showId: show.id, from, mode });
    setStatus(r ? "saved" : "idle");
    return !!r;
  }
  const pick = (from: From, label: string) => { if (items.length === 0) void seed(from, "replace"); else setPending({ from, label }); };

  const templateItems: MenuItem[] = [...m.templates].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({
    key: t.id, label: `${t.name} · ${plural(songCount(t.items))}`, onSelect: () => pick({ kind: "template", id: t.id }, t.name),
  }));
  // The 20 most recent shows with a setlist, newest first: the full history is too long to scroll in a menu.
  const showItems: MenuItem[] = m.setlists
    .filter((s) => s.id !== show.id && s.items.length > 0)
    .flatMap((s) => { const sh = m.shows.find((x) => x.id === s.id); return sh ? [{ s, sh }] : []; })
    .sort((a, b) => b.sh.date.localeCompare(a.sh.date))
    .slice(0, 20)
    .map(({ s, sh }) => ({
      key: s.id, label: `${showName(sh)} · ${fmtDay(sh.date)} · ${plural(songCount(s.items))}`,
      onSelect: () => pick({ kind: "show", id: s.id }, `${showName(sh)} ${fmtDay(sh.date)}`),
    }));
  const none = (label: string): MenuItem[] => [{ key: "none", label, disabled: true, onSelect: () => undefined }];

  return (
    <div className="grid gap-3" data-testid="setlist-tab">
      {admin && (
        <div className="flex flex-wrap items-center gap-2">
          <Menu label="Seed from template" testid="seed-template" trigger={<span className="px-2 text-sm font-semibold">Seed from template ▾</span>}
            items={templateItems.length ? templateItems : none("No templates yet")} />
          <Menu label="Copy from another show" testid="seed-show" trigger={<span className="px-2 text-sm font-semibold">Copy from another show ▾</span>}
            items={showItems.length ? showItems : none("No other show has a setlist")} />
          <SaveStatus status={status} error={saveErr} />
        </div>
      )}
      {sl?.source && <span className="s" data-testid="setlist-source">Seeded from {sl.source.name ?? (sl.source.kind === "template" ? "a template" : "another show")}</span>}

      <div className={`card ${over ? "" : slack != null ? "hi" : ""}`} data-testid="setlist-total" data-over={over ? "1" : "0"}>
        <div className="flex items-baseline justify-between gap-2">
          <b className="font-mono text-xl" style={over ? { color: "var(--danger)" } : undefined} data-testid="total-time">{fmtLen(total)}{setLen ? ` of ${fmtLen(setLen)}` : ""}</b>
          {slack != null && <span className={`chip ${over ? "" : "g"}`} style={over ? { background: "var(--danger-soft)", color: "var(--danger)" } : undefined} data-testid="fit">{over ? `${fmtLen(-slack)} over` : "Fits"}</span>}
        </div>
        <span className="s">{plural(songCount(items))}{!setLen ? " · the show has no set length yet" : ""}</span>
      </div>

      <SetlistItemsEditor items={items} onChange={save} songs={m.songs} admin={admin} bpm
        empty={admin ? "No setlist yet. Seed one from a template or another show, or add songs below." : "No setlist yet."} />

      <ErrorBox error={error} />
      <Dialog open={!!pending} onClose={() => setPending(null)} title="Add to this setlist" testid="seed-dialog">
        {pending && <SeedForm label={pending.label} count={songCount(items)} busy={busy} close={() => setPending(null)} onConfirm={async (mode) => { if (await seed(pending.from, mode)) setPending(null); }} />}
      </Dialog>
    </div>
  );
}

/** Mounts each time the dialog opens, so the choice starts at "Add to end" every time. */
function SeedForm({ label, count, busy, close, onConfirm }: { label: string; count: number; busy: boolean; close(): void; onConfirm(mode: "append" | "replace"): void }) {
  const radioName = useId();
  const [mode, setMode] = useState<"append" | "replace">("append");
  return (
    <>
      <div className="flex justify-end">
        <button type="button" className="icon-btn" aria-label="Close" data-testid="seed-close" onClick={close}><CloseIcon /></button>
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="lbl">This show already has {plural(count)}. Bring in {label}:</legend>
        <div className="flex flex-wrap gap-5">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name={radioName} checked={mode === "append"} onChange={() => setMode("append")} data-testid="seed-mode-append" />
            Add to end
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name={radioName} checked={mode === "replace"} onChange={() => setMode("replace")} data-testid="seed-mode-replace" />
            Replace list
          </label>
        </div>
      </fieldset>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn ghost" data-testid="seed-cancel" onClick={close}>Cancel</button>
        <button type="button" className="btn acc" data-testid="seed-confirm" disabled={busy} onClick={() => onConfirm(mode)}>{mode === "append" ? "Add to end" : "Replace list"}</button>
      </div>
    </>
  );
}
