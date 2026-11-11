"use client";
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";

export type PickedFolder = { id: string; name: string; url?: string };
type Hit = { id: string; name: string; url?: string; ownerEmail?: string };

/**
 * Pick any Drive folder inline (a form field, not a Settings card): search the band's Drive by name or paste a folder
 * link, choose a hit, and the field shows the folder with Change / Clear. The folder can be anywhere, not only in the band folder.
 */
export function FolderPicker({ value, onChange, disabled, testid = "folder" }: { value: PickedFolder | null; onChange(f: PickedFolder | null): void; disabled?: boolean; testid?: string }) {
  const { call, error, busy, setError } = useCommand();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Hit[] | null>(null);
  const isLink = /drive\.google\.com|\/folders\//.test(q);

  const pick = (f: PickedFolder) => { onChange(f); setOpen(false); setQ(""); setFound(null); setError(null); };
  async function find() {
    if (!q.trim()) return;
    if (isLink) {
      const f = await call<PickedFolder>("google.folder", { folder: q.trim() });
      if (f) pick(f);
      return;
    }
    const r = await call<{ folders: Hit[] }>("google.findFolders", { q: q.trim() });
    if (r) setFound(r.folders);
  }
  const onKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void find(); } };

  if (value && !open) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid={`${testid}-picked`}>
        <a href={value.url ?? `https://drive.google.com/drive/folders/${value.id}`} target="_blank" rel="noreferrer"><b>{value.name}</b> ↗</a>
        <button type="button" className="btn text sm" disabled={disabled} onClick={() => setOpen(true)} data-testid={`${testid}-change`}>Change</button>
        <button type="button" className="btn text sm" disabled={disabled} onClick={() => onChange(null)} data-testid={`${testid}-clear`}>Clear</button>
      </div>
    );
  }
  return (
    <div className="grid gap-2" data-testid={`${testid}-form`}>
      <div className="flex gap-2">
        <input className="input" value={q} placeholder="Folder name, or paste a Drive folder link" disabled={disabled} onChange={(e) => { setQ(e.target.value); setFound(null); setError(null); }} onKeyDown={onKey} data-testid={`${testid}-q`} />
        <button type="button" className="btn ghost" disabled={disabled || busy || !q.trim()} onClick={find} data-testid={`${testid}-search`}>{isLink ? "Use link" : "Search"}</button>
        {value && <button type="button" className="btn text" onClick={() => { setOpen(false); setQ(""); setFound(null); setError(null); }} data-testid={`${testid}-cancel`}>Cancel</button>}
      </div>
      {found && found.length === 0 && <span className="s" data-testid={`${testid}-empty`}>No folders with that name in the band&apos;s Drive.</span>}
      {(found ?? []).map((x) => (
        <div key={x.id} className="flex items-center gap-2 rounded-lg border border-line p-2" data-testid={`${testid}-hit-${x.name}`}>
          <span className="grid min-w-0 flex-1"><b className="truncate text-sm">{x.name}</b><span className="s">{x.ownerEmail}</span></span>
          <a className="btn ghost sm" href={x.url} target="_blank" rel="noreferrer">Open</a>
          <button type="button" className="btn acc sm" disabled={busy} onClick={() => pick({ id: x.id, name: x.name, url: x.url })} data-testid={`${testid}-choose`}>Choose</button>
        </div>
      ))}
      <ErrorBox error={error} />
    </div>
  );
}
