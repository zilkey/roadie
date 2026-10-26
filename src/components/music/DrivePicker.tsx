"use client";
import { useEffect, useRef, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { FileIcon } from "./common";
import { KIND_LABEL, KIND_ORDER, type FileKind } from "@/lib/music";
import { Link, useMaybeArtist } from "@/lib/artist";

export interface Hit {
  driveFileId: string; name: string; mimeType: string; url: string; ownerEmail: string;
  inBandFolder: boolean; missing: string[]; kind: FileKind; key: string | null;
}
export interface Pick { driveFileId: string; kind: FileKind; key?: string }
interface Mate { id: string; name: string; email: string }

/**
 * Search Drive, tick files, set kind and key, and fix sharing gaps before attaching.
 * `syncWith` follows another field (the song title). The parent reads picks through onChange.
 */
export function DrivePicker({ syncWith, exclude = [], defaultKind, onChange, testid = "picker" }: {
  syncWith?: string; exclude?: string[]; defaultKind?: FileKind; onChange(picks: Pick[]): void; testid?: string;
}) {
  const { call, error, busy } = useCommand();
  // No band folder chosen yet: nothing can be "in" it, so its chips and Copy to band folder are off (Settings > Google sets it).
  const hasFolder = !!useMaybeArtist()?.doc?.driveFolderId;
  const [q, setQ] = useState(syncWith ?? "");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [mates, setMates] = useState<Mate[]>([]);
  const [sel, setSel] = useState<Record<string, { kind: FileKind; key: string }>>({});
  const searchSeq = useRef(0);

  async function search(text: string) {
    if (!text.trim()) { setHits(null); return; }
    const n = ++searchSeq.current;
    const r = await call<{ files: Hit[]; bandmates: Mate[] }>("drive.search", { q: text.trim() });
    if (!r || n !== searchSeq.current) return;
    setHits(r.files.filter((f) => !exclude.includes(f.driveFileId)));
    setMates(r.bandmates);
    setSel({});
  }

  // Follow the title field, after a short pause.
  useEffect(() => {
    if (syncWith === undefined) return;
    setQ(syncWith);
    const t = setTimeout(() => { if (syncWith.trim().length >= 2) search(syncWith); else setHits(null); }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncWith]);

  useEffect(() => {
    onChange(Object.entries(sel).map(([driveFileId, v]) => ({ driveFileId, kind: v.kind, ...(v.key.trim() ? { key: v.key.trim() } : {}) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const toggle = (h: Hit) => setSel((s) => {
    const { [h.driveFileId]: on, ...rest } = s;
    return on ? rest : { ...s, [h.driveFileId]: { kind: defaultKind ?? h.kind, key: h.key ?? "" } };
  });
  const setPick = (id: string, p: Partial<{ kind: FileKind; key: string }>) => setSel((s) => ({ ...s, [id]: { ...s[id], ...p } }));

  const name = (id: string) => mates.find((m) => m.id === id)?.name ?? "Someone";
  const gappy = (hits ?? []).filter((h) => sel[h.driveFileId] && (h.missing.length || (hasFolder && !h.inBandFolder)));
  const outside = hasFolder ? gappy.filter((h) => !h.inBandFolder) : [];
  const unshared = gappy.filter((h) => h.missing.length);

  async function fix(fix: "copy" | "share", list: Hit[]) {
    const r = await call<{ files: { oldId: string; driveFileId: string; url: string; ownerEmail: string; inBandFolder: boolean; missing: string[] }[] }>("drive.fix", { driveFileIds: list.map((h) => h.driveFileId), fix });
    if (!r) return;
    const by = new Map(r.files.map((f) => [f.oldId, f]));
    setHits((hs) => (hs ?? []).map((h) => { const f = by.get(h.driveFileId); return f ? { ...h, driveFileId: f.driveFileId, url: f.url, ownerEmail: f.ownerEmail, inBandFolder: f.inBandFolder, missing: f.missing } : h; }));
    setSel((s) => {
      const out = { ...s };
      for (const f of r.files) if (f.oldId !== f.driveFileId && out[f.oldId]) { out[f.driveFileId] = out[f.oldId]; delete out[f.oldId]; }
      return out;
    });
  }

  return (
    <div className="grid gap-2" data-testid={testid}>
      <span className="lbl">Found in Drive</span>
      <div className="flex gap-2">
        <input className="input" placeholder="Search Drive by song title…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="drive-q" aria-label="Search Drive"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(q); } }} />
        <button className="btn ghost" type="button" disabled={busy} onClick={() => search(q)} data-testid="drive-search">Search</button>
      </div>
      {hits && hits.length === 0 && <span className="s" data-testid="drive-empty">No audio, video, Docs or Word files match.</span>}
      {(hits ?? []).map((h) => {
        const on = sel[h.driveFileId];
        return (
          <div key={h.driveFileId} className="grid gap-1.5 rounded-lg border border-line p-2" data-testid={`hit-${h.name}`}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!on} onChange={() => toggle(h)} data-testid="hit-check" aria-label={`Pick ${h.name}`} />
              <FileIcon mime={h.mimeType} />
              <span className="grid min-w-0 flex-1"><b className="truncate text-sm">{h.name}</b><span className="s">{h.ownerEmail}</span></span>
              {hasFolder && (h.inBandFolder ? <span className="chip g">Band folder</span> : <span className="chip a" data-testid="outside-band">Outside band folder</span>)}
            </label>
            {h.missing.length > 0 && <span className="s" data-testid="cant-open">Can&apos;t open: {h.missing.map(name).sort().join(", ")}</span>}
            {on && (
              <div className="flex flex-wrap gap-2">
                <select className="select !w-auto" value={on.kind} onChange={(e) => setPick(h.driveFileId, { kind: e.target.value as FileKind })} aria-label="Kind" data-testid="hit-kind">
                  {KIND_ORDER.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                <input className="input !w-28" placeholder="Key" value={on.key} onChange={(e) => setPick(h.driveFileId, { key: e.target.value })} aria-label="Key" data-testid="hit-key" />
              </div>
            )}
          </div>
        );
      })}
      {gappy.length > 0 && (
        <div className="card hi" data-testid="picker-gap">
          <b>{gappy.length} picked file{gappy.length === 1 ? "" : "s"} the band can&apos;t fully open</b>
          <span className="s">Fix it now, or attach and fix later.</span>
          <div className="flex flex-wrap gap-2">
            {(outside.length > 0 || !hasFolder) && (
              <button type="button" className="btn ghost sm" disabled={busy || !hasFolder} title={hasFolder ? undefined : NO_FOLDER}
                onClick={() => fix("copy", outside)} data-testid="picker-copy">Copy to band folder</button>
            )}
            {unshared.length > 0 && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => fix("share", unshared)} data-testid="picker-share">Share with band</button>}
          </div>
          {!hasFolder && <NoBandFolder />}
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
}

const NO_FOLDER = "Choose the band folder on Settings > Google first";

/** Why Copy to band folder is off, with the way to turn it on. */
export function NoBandFolder() {
  return <span className="s" data-testid="no-band-folder">No band folder chosen yet. <Link href="/admin/google">Choose it in Settings › Google</Link> to copy files into it.</span>;
}
