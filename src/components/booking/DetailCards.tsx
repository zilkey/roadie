"use client";
import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { useArtist } from "@/lib/artist";
import { FlagIcon } from "./common";

/** Shown at the top of an editing shared card. */
export const SHARED_WARN = "Every band on Band Tracker sees these details.";
/** The venue version points at the band's private notes. */
export const VENUE_SHARED_WARN = "Every band on Band Tracker sees these details. Keep private notes in “Our notes” below.";

const Svg = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">{children}</svg>
);
const GlobeIcon = ({ size }: { size?: number }) => <Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" /></Svg>;
const LockIcon = ({ size }: { size?: number }) => <Svg size={size}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></Svg>;

/** A detail page: back link, title (+ pill), meta line, a `more` menu at the top right, then a single column of cards. */
export function DetailPage({ back, title, pill, meta, more, children, testid }: {
  back: ReactNode; title: ReactNode; pill?: ReactNode; meta?: ReactNode; more?: ReactNode; children: ReactNode; testid?: string;
}) {
  return (
    <div className="d-page" data-testid={testid}>
      <header className="d-head">
        {back}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="page-title" data-testid="page-title">{title}</h1>
              {pill}
            </div>
            {meta && <span className="text-[16px] text-muted">{meta}</span>}
          </div>
          {more}
        </div>
      </header>
      {children}
    </div>
  );
}

/** The "On the Pitch List" pill: filled flag, pitch color. */
export function PitchedPill() {
  return <span className="d-pitched"><FlagIcon filled />On the Pitch List</span>;
}

/** The label row above a run of cards: shared with every band, or private to this artist. Cards stay direct children of the page grid. */
export function CardGroup({ kind, children }: { kind: "shared" | "private"; children: ReactNode }) {
  const { name } = useArtist();
  const priv = kind === "private";
  return (
    <>
      <div className={`d-grp${priv ? " priv" : ""}`}>
        {priv ? <LockIcon /> : <GlobeIcon />}
        {priv ? `Only ${name} sees this` : "Shared with every band on Band Tracker"}
      </div>
      {children}
    </>
  );
}

/** Only one card edits at a time; opening another replaces the current one. */
export function useSingleEdit<K extends string>() {
  const [editing, setEditing] = useState<K | null>(null);
  const open = useCallback((k: K) => setEditing(k), []);
  const close = useCallback(() => setEditing(null), []);
  const is = useCallback((k: K) => editing === k, [editing]);
  return useMemo(() => ({ editing, open, close, is }), [editing, open, close, is]);
}

/**
 * A card with a title and, if `editKey` + `edit` are given, an Edit link that swaps `children` for `editChildren` plus a Done footer.
 * `warn` (editing only) shows a globe line at the top. `headerExtra` sits beside the Edit link/tag. Autosave: Done just closes (after `onDone`).
 */
export function DetailCard<K extends string = string>({ title, icon, private: priv, editKey, edit, warn, onDone, testid, editTestid, doneTestid, headerExtra, children, editChildren }: {
  title: ReactNode; icon?: ReactNode; private?: boolean; editKey?: K; edit?: ReturnType<typeof useSingleEdit<K>>; warn?: ReactNode;
  onDone?(): void; testid?: string; editTestid?: string; doneTestid?: string; headerExtra?: ReactNode; children?: ReactNode; editChildren?: ReactNode;
}) {
  const id = useId();
  const canEdit = editKey !== undefined && !!edit;
  const editing = canEdit && edit.is(editKey);
  return (
    <section className={`d-card${priv ? " priv" : ""}${editing ? " editing" : ""}`} aria-labelledby={id} data-testid={testid}>
      <div className="d-ch">
        <h2 id={id} className="d-ct">{icon}{title}</h2>
        <div className="flex items-center gap-2">
          {headerExtra}
          {editing ? <span className="d-tag">Editing</span>
            : canEdit && <button type="button" className="d-edit" onClick={() => edit.open(editKey)} data-testid={editTestid}>Edit</button>}
        </div>
      </div>
      {editing ? (
        <>
          {warn && <div className="d-warn"><GlobeIcon size={14} /><span>{warn}</span></div>}
          {editChildren}
          <div className="d-foot">
            <button type="button" className="btn acc" data-testid={doneTestid} onClick={() => { onDone?.(); edit.close(); }}>Done</button>
          </div>
        </>
      ) : children}
    </section>
  );
}

/** Label/value rows; an empty value shows a muted dash. Rows may carry a testid for the value. */
export function KV({ rows }: { rows: [string, ReactNode, string?][] }) {
  return (
    <dl className="d-kv m-0">
      {rows.map(([k, v, testid]) => (
        <div key={k} className="contents">
          <dt className="d-k">{k}</dt>
          <dd className="m-0 min-w-0" data-testid={testid}>{v === null || v === undefined || v === false || v === "" ? <span className="d-muted">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}
