"use client";
import { draftPath } from "@/schema/drafts";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { STATUS_LABEL, isActive, sortedDates, datePast, fmtPitchDate, todayStr, type Status } from "@/lib/booking";
import { useCommand, ErrorBox, Select } from "@/components/ui";
import { withNotes, type NoteFields } from "@/lib/venues";
import { SaveStatus } from "@/components/SaveStatus";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useAutosave } from "@/lib/autosave";
import { useDraft, useHasDraft } from "@/lib/drafts";
import { newMutationId, type CommandMeta } from "@/lib/commands";
import type { Venue, VenueNote, Promoter, Festival, Edition, Contact, Pitch, PitchDate, Comment } from "@/schema";

export type PitchRow = Row<Omit<Pitch, "createdAt" | "updatedAt" | "deletedAt" | "lastContactAt">> & { lastContactAt?: { toMillis(): number } };

/** A venue as the band sees it: the shared room with this band's private notes laid over it (so `contactIds` etc. are the band's own). */
export type VenueRow = Row<Omit<Venue, keyof NoteFields>> & NoteFields;

/**
 * All booking collections, live. Small data set, so every page just loads what it needs.
 * Venues are the shared directory (everyone reads it); the band's private notes are `venueNotes` (admins only, so for members nothing
 * but the venues is loaded). `venues` leaves out rooms this band archived and carries the band's notes; `venueNotes` has them all, archived too.
 */
export function useBooking() {
  const { artistId, role } = useArtist();
  const admin = role === "admin";
  const venues = useCollection<Venue>("venues");
  const notes = useCollection<VenueNote>("venueNotes", { where: [["artistId", "==", artistId]], includeDeleted: true, skip: !admin });
  const promoters = useCollection<Promoter>("promoters", { skip: !admin });
  const festivals = useCollection<Festival>("festivals", { skip: !admin });
  const editions = useCollection<Edition>("editions", { skip: !admin });
  const contacts = useCollection<Contact>("contacts", { skip: !admin });
  const pitches = useCollection<PitchRow>("pitches", { skip: !admin });
  const venueNotes = useMemo(() => new Map((notes.rows ?? []).map((n) => [n.venueId, n])), [notes.rows]);
  const venueRows = useMemo<VenueRow[]>(
    () => (venues.rows ?? []).filter((v) => !venueNotes.get(v.id)?.deletedAt).map((v) => withNotes(v, venueNotes.get(v.id)) as VenueRow),
    [venues.rows, venueNotes]);
  return {
    venues: venueRows, venueNotes, promoters: promoters.rows ?? [], festivals: festivals.rows ?? [],
    editions: editions.rows ?? [], contacts: contacts.rows ?? [], pitches: pitches.rows ?? [],
    loading: [venues, notes, promoters, festivals, editions, contacts, pitches].some((c) => c.loading),
  };
}

export const KIND_PATH = { venue: "venues", promoter: "promoters", edition: "editions", festival: "festivals", contact: "contacts" } as const;
export const hrefFor = (kind: keyof typeof KIND_PATH, id: string) => `/booking/${KIND_PATH[kind]}/${id}`;

export function BackLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="s font-semibold" data-testid="back">← {label}</Link>;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } finally { t.remove(); }
    }
    setDone(true); setTimeout(() => setDone(false), 1500);
  }
  return <button type="button" className="btn ghost sm" onClick={copy} data-testid="copy-email" data-copy={text}>{done ? "Copied" : label}</button>;
}

export function StatusChip({ status }: { status: string }) {
  const cls = status === "booked" ? "g" : status === "declined" || status === "dropped" ? "" : status === "idea" || status === "toPitch" ? "a" : "m";
  return <span className={`chip ${cls}`} data-testid="status-chip">{STATUS_LABEL[status as Status] ?? status}</span>;
}

const FlagIcon = ({ filled }: { filled: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 3v18M6 4h12l-3 4 3 4H6" />
  </svg>
);

/**
 * A pitch's configuration, picked from the artist's configurations (stores the id; "" = not sure yet). With none yet,
 * admins get the link to make some instead of an empty dropdown. Pitches are admin-only, so the link is always allowed.
 */
export function ConfigurationPicker({ value, onChange, testid, onKeyDown }: { value: string; onChange(id: string): void; testid?: string; onKeyDown?: React.KeyboardEventHandler }) {
  const artist = useArtist();
  const configs = artist.doc?.configurations ?? [];
  const edit = artist.role === "admin" && <Link href="/admin/artist" className="s font-semibold" data-testid="edit-configurations">{configs.length === 0 ? "Add configurations" : "Edit"}</Link>;
  return (
    <div className="grid gap-1" onKeyDown={onKeyDown}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="lbl">Configuration</span>
        {edit}
      </div>
      {configs.length === 0
        ? <span className="s">No configurations yet.</span>
        : <Select<string> value={value} onChange={onChange} placeholder="Not sure yet" label="Configuration" testid={testid} options={configs.map((c) => [c.id, c.name] as [string, string])} />}
    </div>
  );
}

/** A pitch's possible dates, one row each: date, optional last day of a run, optional note. Rows may be blank while being filled in. */
export type DateRow = { date: string; endDate?: string; note?: string };
export const completeDates = (rows: DateRow[]): PitchDate[] =>
  sortedDates(rows.filter((r) => r.date).map((r) => ({ date: r.date, ...(r.endDate ? { endDate: r.endDate } : {}), ...(r.note?.trim() ? { note: r.note.trim() } : {}) })));
export const datesProblem = (rows: DateRow[]) => rows.some((r) => r.date && r.endDate && r.endDate < r.date) ? "an end date can't be before its start" : null;

export function PitchDatesEditor({ rows, onChange, onBlur, testid }: { rows: DateRow[]; onChange(rows: DateRow[]): void; onBlur?(): void; testid: string }) {
  const set = (i: number, p: Partial<DateRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="grid gap-2" data-testid={testid} onBlur={onBlur}>
      <span className="lbl">Possible dates</span>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-2 items-end gap-2 md:grid-cols-[9rem_9rem_minmax(0,1fr)_auto]" data-testid={`${testid}-row-${i}`}>
          <label className="grid gap-1"><span className="s">Date</span><input className="input" type="date" value={r.date} onChange={(e) => set(i, { date: e.target.value })} data-testid={`${testid}-date-${i}`} /></label>
          <label className="grid gap-1"><span className="s">Through (optional)</span><input className="input" type="date" value={r.endDate ?? ""} min={r.date || undefined} onChange={(e) => set(i, { endDate: e.target.value })} data-testid={`${testid}-end-${i}`} /></label>
          <label className="col-span-2 grid gap-1 md:col-span-1"><span className="s">Note</span><input className="input" placeholder="e.g. their preferred" value={r.note ?? ""} onChange={(e) => set(i, { note: e.target.value })} data-testid={`${testid}-note-${i}`} /></label>
          <button type="button" className="btn danger sm col-span-2 justify-self-start md:col-span-1" onClick={() => onChange(rows.filter((_, j) => j !== i))} data-testid={`${testid}-remove-${i}`}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn ghost sm justify-self-start" onClick={() => onChange([...rows, { date: "" }])} data-testid={`${testid}-add`}>Add a date</button>
    </div>
  );
}

/**
 * Possible dates as removable chips with a date input and a round + beside it (the flag form). Same data as PitchDatesEditor:
 * a run's last day and a note are optional extras next to the date. A date only joins the list when + is pressed.
 */
export function PitchDatesChips({ rows, onChange, testid }: { rows: DateRow[]; onChange(rows: DateRow[]): void; testid: string }) {
  const [draft, setDraft] = useState<DateRow>({ date: "" });
  const bad = !!draft.endDate && draft.endDate < draft.date;
  const canAdd = !!draft.date && !bad;
  function add() {
    if (!canAdd) return;
    onChange(completeDates([...rows, draft]));
    setDraft({ date: "" });
  }
  const enter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
  return (
    <div className="grid gap-2" data-testid={testid}>
      <label className="lbl" htmlFor={`${testid}-date`}>Possible dates</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id={`${testid}-date`} className="input !w-auto" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} onKeyDown={enter} data-testid={`${testid}-date`} />
        <input className="input !w-auto" type="date" aria-label="Through (optional)" title="Through (optional)" value={draft.endDate ?? ""} min={draft.date || undefined} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} onKeyDown={enter} data-testid={`${testid}-end`} />
        <input className="input !w-40" placeholder="Note (optional)" aria-label="Note (optional)" value={draft.note ?? ""} onChange={(e) => setDraft({ ...draft, note: e.target.value })} onKeyDown={enter} data-testid={`${testid}-note`} />
        <button type="button" className="round-btn" aria-label="Add date" disabled={!canAdd} onClick={add} data-testid={`${testid}-add`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
      {(draft.date || draft.endDate) && <span className="s" data-testid={`${testid}-hint`}>{bad ? "An end date can't be before its start." : "Press + to add this date."}</span>}
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {rows.map((r, i) => (
            <span key={`${r.date}-${i}`} className="chip w lg" data-testid={`${testid}-chip-${i}`}>
              {fmtPitchDate(r)}{r.note ? ` (${r.note})` : ""}
              <button type="button" aria-label={`Remove ${fmtPitchDate(r)}`} onClick={() => onChange(rows.filter((_, j) => j !== i))} data-testid={`${testid}-remove-${i}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The dates of a pitch as one line of text, past ones dimmed. Nothing when there are none. */
export function PitchDates({ dates, today, testid }: { dates?: PitchDate[]; today: string; testid?: string }) {
  const list = sortedDates(dates);
  if (!list.length) return null;
  return (
    <span className="s flex flex-wrap gap-x-2" data-testid={testid}>
      {list.map((d, i) => (
        <span key={i} className={datePast(d, today) ? "opacity-50" : "font-semibold"} data-past={datePast(d, today) ? "1" : "0"}>{fmtPitchDate(d)}{d.note ? ` (${d.note})` : ""}</span>
      ))}
    </span>
  );
}

/**
 * Flag = add to the Pitch List. `button` is the flag itself (filled = already there; tapping it opens the pitch, unflagged opens
 * the form). `form` is the add form: render it under the row's button line, never inside the button's flex row.
 * `strip` is the summary of the open pitch (configuration, dates, last comment); it is empty while there is no pitch.
 */
function useFlag(kind: "venue" | "promoter" | "edition", id: string, pitches: PitchRow[], opts: { big?: boolean; square?: boolean } = {}) {
  const { call, error, busy } = useCommand();
  const router = useRouter();
  const open = pitches.find((p) => p.target.kind === kind && p.target.id === id && isActive(p.status));
  const [showForm, setShowForm] = useState(false);
  const [pitchedAs, setPitchedAs] = useState("");
  const [comment, setComment] = useState("");
  const [dates, setDates] = useState<DateRow[]>([]);
  const btn = useRef<HTMLButtonElement>(null);
  const formOpen = showForm && !open;

  function close() { setShowForm(false); setPitchedAs(""); setComment(""); setDates([]); btn.current?.focus(); }
  function tap(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (open) return router.push(`/booking/pitches/${open.id}`);
    if (formOpen) return close();
    setShowForm(true);
  }
  const problem = datesProblem(dates);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); e.stopPropagation();
    if (problem) return;
    const r = await call<{ id: string }>("pitches.flag", { kind, id, ...(completeDates(dates).length ? { dates: completeDates(dates) } : {}), ...(pitchedAs ? { pitchedAs } : {}) });
    if (!r) return;
    // the first comment is a real comment on the new pitch (its timeline), not the pitch's notes field
    if (comment.trim()) await call("pitches.comment", { id: r.id, body: comment.trim() });
    close();
  }
  const escape = (e: React.KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };

  const button = (
    <button ref={btn} type="button" onClick={tap} onKeyDown={(e) => { if (formOpen) escape(e); }} disabled={busy} data-testid={`flag-${id}`} data-flagged={open ? "1" : "0"} data-open={formOpen ? "1" : "0"}
      aria-label={open ? "On the Pitch List" : "Add to Pitch List"} aria-pressed={!!open || formOpen} aria-expanded={open ? undefined : formOpen}
      className={opts.square ? "flag-sq" : `${opts.big ? `btn ${open ? "ghost" : "acc"}` : `btn sm ${open ? "acc" : "ghost"}`} flag-btn`}>
      <FlagIcon filled={!!open} />{opts.big && (open ? "On the Pitch List" : "Add to Pitch List")}
    </button>
  );
  const form = (
    <>
      {formOpen && (
        <form onSubmit={submit} onClick={(e) => e.stopPropagation()} onKeyDown={escape} aria-label="Add to Pitch List"
          className={opts.square ? "card-tint grid gap-4" : "mt-2 grid w-full gap-2 border-t border-line pt-2"} data-testid={`flag-form-${id}`}>
          <div className="grid gap-4 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:items-start">
            <ConfigurationPicker value={pitchedAs} onChange={setPitchedAs} testid={`flag-pitchedAs-${id}`} />
            <PitchDatesChips rows={dates} onChange={setDates} testid={`flag-dates-${id}`} />
          </div>
          <label className="grid gap-1">
            <span className="lbl">First comment <span className="font-medium">(optional)</span></span>
            <input className="input" type="text" value={comment} placeholder="e.g. Emailed Sam, they book 3 months out" data-testid={`flag-comment-${id}`}
              onChange={(e) => setComment(e.target.value)} />
          </label>
          {problem && <span className="note s" data-testid={`flag-dates-problem-${id}`}>{problem}</span>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn ghost" onClick={close} data-testid={`flag-cancel-${id}`}>Cancel</button>
            <button type="submit" className="btn acc" disabled={busy || !!problem} data-testid={`flag-submit-${id}`}>Add to pitch list</button>
          </div>
        </form>
      )}
      {error && <ErrorBox error={error} />}
    </>
  );
  const strip = open && opts.square ? <PitchStrip pitch={open} /> : null;
  return { button, form, strip };
}

/** The pitch behind a flagged row: its configuration, possible dates and the latest comment, in the tinted strip under the row. */
export function PitchStrip({ pitch }: { pitch: PitchRow }) {
  const artist = useArtist();
  const config = artist.doc?.configurations?.find((c) => c.id === pitch.pitchedAs)?.name ?? "Not sure yet";
  const dates = sortedDates(pitch.dates);
  const today = todayStr();
  const last = useCollection<Comment>(`pitches/${pitch.id}/comments`, { order: ["createdAt", "desc"], limit: 1 }).rows?.[0];
  const at = last?.createdAt;
  const when = at ? (at instanceof Date ? at : at.toDate()).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  return (
    <div className="card-tint grid gap-2" data-testid={`pitch-strip-${pitch.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <b data-testid={`pitch-strip-config-${pitch.id}`}>{config}</b>
        <div className="flex flex-wrap items-center gap-2" data-testid={`pitch-strip-dates-${pitch.id}`}>
          {dates.map((d, i) => <span key={i} className={`chip w ${datePast(d, today) ? "opacity-60" : ""}`} data-past={datePast(d, today) ? "1" : "0"}>{fmtPitchDate(d)}{d.note ? ` (${d.note})` : ""}</span>)}
          {dates.length === 0 && <span className="s">No dates yet</span>}
        </div>
      </div>
      <div className="flex min-w-0 items-baseline gap-2 text-sm" data-testid={`pitch-strip-comment-${pitch.id}`}>
        <span className="lbl uppercase tracking-wider">Last comment</span>
        {last
          ? <><span className="min-w-0 flex-1 truncate">{last.body}</span><span className="s shrink-0">{when}</span></>
          : <span className="s">None yet</span>}
      </div>
    </div>
  );
}

/** Render prop over the flag: `{(button, form, strip) => ...}`. Put the button in the row's flex line and the form (or, once pitched, the strip) below that line. `square` is the list row's 44px flag button and tinted panels. */
export function Flagged({ kind, id, pitches, big, square, children }: { kind: "venue" | "promoter" | "edition"; id: string; pitches: PitchRow[]; big?: boolean; square?: boolean; children(button: React.ReactNode, form: React.ReactNode, strip: React.ReactNode): React.ReactNode }) {
  const f = useFlag(kind, id, pitches, { big, square });
  return <>{children(f.button, f.form, f.strip)}</>;
}

/** View switcher or filter: a tab bar, never a form field. Arrow keys / Home / End move between tabs. */
export function Tabs<T extends string>({ value, options, onChange, testid }: { value: T; options: [T, React.ReactNode][]; onChange(v: T): void; testid?: string }) {
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = options.findIndex(([v]) => v === value);
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % options.length
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + options.length) % options.length
      : e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next][0]);
    (e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next])?.focus();
  }
  return (
    <div className="tabs" role="tablist" data-testid={testid} onKeyDown={onKey}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} tabIndex={value === v ? 0 : -1} onClick={() => onChange(v)} data-testid={`${testid}-${v}`}>{l}</button>
      ))}
    </div>
  );
}

// ---------- generic entity form ----------

export interface Field {
  key: string; label: string; type?: "text" | "number" | "date" | "textarea" | "select"; required?: boolean;
  options?: [string, string][]; placeholder?: string; half?: boolean;
}
export type Values = Record<string, string>;

/** The field grid shared by every EntityForm mode. */
export function FormFields({ fields, v, set, testid, onBlur }: { fields: Field[]; v: Values; set(k: string, val: string): void; testid: string; onBlur?(): void }) {
  return (
    <div className="grid grid-cols-2 gap-2" onBlur={onBlur}>
      {fields.map((f) => (
        <label key={f.key} className={`grid gap-1 ${f.half ? "" : "col-span-2"}`}>
          <span className="lbl">{f.label}{f.required ? " *" : ""}</span>
          {f.type === "textarea" ? (
            <textarea className="input" rows={3} value={v[f.key] ?? ""} placeholder={f.placeholder} data-testid={`${testid}-${f.key}`} onChange={(e) => set(f.key, e.target.value)} />
          ) : f.type === "select" ? (
            <select className="select" value={v[f.key] ?? ""} data-testid={`${testid}-${f.key}`} onChange={(e) => set(f.key, e.target.value)}>
              {f.options!.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
            </select>
          ) : (
            <input className="input" type={f.type ?? "text"} required={f.required} value={v[f.key] ?? ""} placeholder={f.placeholder}
              data-testid={`${testid}-${f.key}`} onChange={(e) => set(f.key, e.target.value)} />
          )}
        </label>
      ))}
    </div>
  );
}

/** Sent with a create so a double tap creates once and the draft goes away with it. Pass it on: `call("x.create", data, meta)`. */
export type SubmitMeta = CommandMeta;

interface EntityFormProps {
  fields: Field[]; initial: Values; build(v: Values): Record<string, unknown>; testid: string; onCancel?(): void;
  /** Label of the explicit button (create forms and legacy edit forms). Not used with `autosave`. */
  submitLabel?: string;
  /** Resolves true to reset the form (create forms). `meta` has clientMutationId (+ clearDraft with `draft`): pass it to `call`. */
  onSubmit?(data: Record<string, unknown>, meta: SubmitMeta): Promise<boolean | void>;
  /** EXISTING record: no Save button; each field saves as a patch through `command` (a `<kind>.update`) on blur / after a pause. */
  autosave?: { command: string; id: string; rev?: number; /** Name of the record, for Home's "Unsaved changes to ..." */ title?: string };
  /** NEW record: values are kept as a draft (device + server) and restored on any machine. The explicit create button stays. */
  draft?: { path: string; title?(v: Values): string; route?: string };
}

/**
 * `build` turns form values into command input; undefined fields are sent as null on edit (cleared).
 * Three modes: plain (legacy Save button), `autosave` (existing record), `draft` (new record).
 */
export function EntityForm(p: EntityFormProps) {
  if (p.autosave) return <AutoEntityForm {...p} autosave={p.autosave} />;
  if (p.draft) return <DraftEntityForm {...p} draft={p.draft} />;
  return <PlainEntityForm {...p} />;
}

function SubmitRow({ busy, label, testid, onCancel }: { busy: boolean; label?: string; testid: string; onCancel?(): void }) {
  return (
    <div className="flex gap-2">
      <button className="btn acc" disabled={busy} data-testid={`${testid}-submit`}>{label ?? "Save"}</button>
      {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
    </div>
  );
}

function PlainEntityForm({ fields, initial, build, submitLabel, onSubmit, testid, onCancel }: EntityFormProps) {
  const [v, setV] = useState<Values>(initial);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { if ((await onSubmit?.(build(v), {})) === true) setV(initial); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="card" data-testid={testid}>
      <FormFields fields={fields} v={v} set={(k, val) => setV({ ...v, [k]: val })} testid={testid} />
      <SubmitRow busy={busy} label={submitLabel} testid={testid} onCancel={onCancel} />
    </form>
  );
}

const jsonOf = (o: Record<string, unknown>) => JSON.stringify(o);
/** Top-level keys whose built value differs between two form states (undefined = cleared = null). */
export function changedKeys(build: (v: Values) => Record<string, unknown>, a: Values, b: Values) {
  const pa = toPatch(build(a)), pb = toPatch(build(b)), out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) if (jsonOf({ v: pa[k] ?? null }) !== jsonOf({ v: pb[k] ?? null })) out[k] = pb[k] ?? null;
  return out;
}

function AutoEntityForm({ fields, initial, build, testid, autosave }: EntityFormProps & { autosave: NonNullable<EntityFormProps["autosave"]> }) {
  const [v, setV] = useState<Values>(initial);
  const queued = useRef<Values>(initial); // the form state the last queued patch brought the server to; edits are diffed against it
  const as = useAutosave({ ...autosave, onUseTheirs: () => { setV(initial); queued.current = initial; } });
  // Follow the live document (someone else's edit, an Undo) whenever nothing of ours is waiting to be saved.
  const initialKey = JSON.stringify(initial);
  useEffect(() => { if (!as.isBusy()) { setV(initial); queued.current = initial; } }, [initialKey]); // eslint-disable-line react-hooks/exhaustive-deps
  function set(k: string, val: string) {
    const next = { ...v, [k]: val };
    setV(next);
    const missing = fields.find((f) => f.required && !(next[f.key] ?? "").trim());
    if (missing) return as.hold(`${missing.label} is required`); // the server would refuse it; saved once it is filled in
    as.patch(changedKeys(build, queued.current, next));
    queued.current = next;
  }
  return (
    <form className="card" data-testid={testid} onSubmit={(e) => e.preventDefault()}>
      <FormFields fields={fields} v={v} set={set} testid={testid} onBlur={() => void as.flush()} />
      <SaveStatus {...as.statusProps} />
    </form>
  );
}

function DraftEntityForm({ fields, initial, build, submitLabel, onSubmit, testid, onCancel, draft }: EntityFormProps & { draft: NonNullable<EntityFormProps["draft"]> }) {
  const d = useDraft<Values>(draft.path, initial, { title: draft.title, route: draft.route });
  const [busy, setBusy] = useState(false);
  const mutationId = useRef(newMutationId());
  if (!d.ready) return <div className="card s">Loading…</div>;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await d.settle();
      if ((await onSubmit?.(build(d.value), { clientMutationId: mutationId.current, clearDraft: d.draftId })) === true) {
        await d.clear({ reset: true }); mutationId.current = newMutationId();
      }
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="card" data-testid={testid}>
      <FormFields fields={fields} v={d.value} set={(k, val) => d.setValue((x) => ({ ...x, [k]: val }))} testid={testid} />
      <DraftNote restoredAt={d.restoredAt} status={d.status} onStartOver={() => void d.clear({ reset: true })} />
      <SubmitRow busy={busy} label={submitLabel} testid={testid} onCancel={onCancel} />
    </form>
  );
}

const opt = (s: string) => (s.trim() ? s.trim() : undefined);
const num = (s: string) => (s.trim() ? Number(s) : undefined);
const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const o = (...pairs: [string, string][]) => pairs;
const REGIONS = o(["boulder", "Boulder"], ["denver", "Denver"], ["north", "North"], ["south", "South"], ["mountains", "Mountains"], ["southwest", "Southwest"], ["out", "Out of state"]);

/** The shared room: name, address and facts every band sees. Edited with an explicit Save (and a confirmation), because it changes the room for every band. */
export const roomForm = {
  fields: [
    { key: "name", label: "Name", required: true },
    { key: "type", label: "Type", type: "select", half: true, options: o(["bar", "Bar"], ["club", "Club"], ["listening", "Listening room"], ["brewery", "Brewery"], ["theater", "Theater"], ["outdoor", "Outdoor"], ["house", "House"], ["other", "Other"]) },
    { key: "region", label: "Region", type: "select", half: true, options: REGIONS },
    { key: "city", label: "City", required: true, half: true }, { key: "state", label: "State", required: true, half: true },
    { key: "street", label: "Street", half: true }, { key: "zip", label: "Zip", half: true },
    { key: "capacity", label: "Capacity", type: "number", half: true },
    { key: "ages", label: "Ages", type: "select", half: true, options: o(["", "Not sure"], ["all", "All ages"], ["18", "18+"], ["21", "21+"]) },
    { key: "soundProvider", label: "Sound", type: "select", half: true, options: o(["", "Not sure"], ["venueProvided", "Venue provides"], ["bandProvided", "Band brings"]) },
    { key: "soundNotes", label: "Sound notes", half: true },
    { key: "website", label: "Website", half: true }, { key: "instagram", label: "Instagram", half: true },
  ] as Field[],
  initial: (d: Pick<Venue, "name" | "type" | "region" | "address" | "capacity" | "ages" | "sound" | "website" | "instagram">): Values => ({
    name: d.name, type: d.type, region: d.region, city: d.address.city, state: d.address.state, street: d.address.street ?? "", zip: d.address.zip ?? "",
    capacity: d.capacity?.toString() ?? "", ages: d.ages ?? "", soundProvider: d.sound?.provider ?? "", soundNotes: d.sound?.notes ?? "",
    website: d.website ?? "", instagram: d.instagram ?? "",
  }),
  build: (v: Values) => ({
    name: v.name, type: v.type, region: v.region, address: { city: v.city, state: v.state, street: opt(v.street ?? ""), zip: opt(v.zip ?? "") },
    capacity: num(v.capacity ?? ""), ages: opt(v.ages ?? ""), sound: v.soundProvider ? { provider: v.soundProvider, notes: opt(v.soundNotes ?? "") } : undefined,
    website: opt(v.website ?? ""), instagram: opt(v.instagram ?? ""),
  }),
};
/** This band's private notes on a venue (admins only). They autosave. */
export const venueNotesForm = {
  fields: [{ key: "loadInNotes", label: "Load-in notes", type: "textarea" }, { key: "notes", label: "Notes", type: "textarea" }] as Field[],
  initial: (d: NoteFields): Values => ({ loadInNotes: d.loadInNotes ?? "", notes: d.notes ?? "" }),
  build: (v: Values) => ({ loadInNotes: opt(v.loadInNotes ?? ""), notes: opt(v.notes ?? "") }),
};
/** The new-venue form: the room plus (for admins) the band's first notes. venues.create splits it across the two documents. */
export const venueForm = {
  fields: [...roomForm.fields, ...venueNotesForm.fields],
  blank: { type: "bar", region: "denver", city: "", state: "CO", ages: "", soundProvider: "" } as Values,
  build: (v: Values) => ({ ...roomForm.build(v), ...venueNotesForm.build(v) }),
};
export const promoterForm = {
  fields: [
    { key: "name", label: "Name", required: true },
    { key: "kind", label: "Kind", type: "select", half: true, options: o(["promoter", "Promoter"], ["venueGroup", "Venue group"], ["nonprofit", "Nonprofit"], ["buyer", "Buyer"]) },
    { key: "website", label: "Website", half: true },
    { key: "howToPitch", label: "How to pitch", type: "textarea" }, { key: "notes", label: "Notes", type: "textarea" },
  ] as Field[],
  blank: { kind: "promoter" } as Values,
  initial: (d: Promoter): Values => ({ name: d.name, kind: d.kind, website: d.website ?? "", howToPitch: d.howToPitch ?? "", notes: d.notes ?? "" }),
  build: (v: Values) => ({ name: v.name, kind: v.kind, website: opt(v.website ?? ""), howToPitch: opt(v.howToPitch ?? ""), notes: opt(v.notes ?? "") }),
};
export const festivalForm = {
  fields: [
    { key: "name", label: "Name", required: true },
    { key: "type", label: "Type", type: "select", half: true, options: o(["festival", "Festival"], ["series", "Series"]) },
    { key: "region", label: "Region", type: "select", half: true, options: REGIONS },
    { key: "genres", label: "Genres", half: true }, { key: "typicalMonth", label: "Usual month (1-12)", type: "number", half: true },
    { key: "website", label: "Website" }, { key: "notes", label: "Notes", type: "textarea" },
  ] as Field[],
  blank: { type: "festival", region: "denver" } as Values,
  initial: (d: Festival): Values => ({ name: d.name, type: d.type, region: d.region, genres: d.genres ?? "", typicalMonth: d.typicalMonth?.toString() ?? "", website: d.website ?? "", notes: d.notes ?? "" }),
  build: (v: Values) => ({ name: v.name, type: v.type, region: v.region, genres: opt(v.genres ?? ""), typicalMonth: num(v.typicalMonth ?? ""), website: opt(v.website ?? ""), notes: opt(v.notes ?? "") }),
};
export const editionForm = {
  fields: [
    { key: "label", label: "Label (e.g. 2027)", required: true, half: true }, { key: "year", label: "Year", type: "number", required: true, half: true },
    { key: "startDate", label: "Starts", type: "date", half: true }, { key: "endDate", label: "Ends", type: "date", half: true },
    { key: "appOpens", label: "Applications open", type: "date", half: true },
    { key: "appOpensSure", label: "How sure", type: "select", half: true, options: o(["estimated", "Estimated"], ["confirmed", "Confirmed"]) },
    { key: "appDeadline", label: "Application deadline", type: "date", half: true },
    { key: "appDeadlineSure", label: "How sure", type: "select", half: true, options: o(["estimated", "Estimated"], ["confirmed", "Confirmed"], ["target", "Our target"]) },
    { key: "notifyDate", label: "Decision by", type: "date", half: true }, { key: "applyUrl", label: "Apply link", half: true },
    { key: "payNotes", label: "Pay", half: true }, { key: "notes", label: "Notes", type: "textarea" },
  ] as Field[],
  blank: { year: String(new Date().getFullYear() + 1), appOpensSure: "estimated", appDeadlineSure: "estimated" } as Values,
  initial: (d: Edition): Values => ({
    label: d.label, year: String(d.year), startDate: d.startDate ?? "", endDate: d.endDate ?? "", appOpens: d.appOpens?.date ?? "", appOpensSure: d.appOpens?.sure ?? "estimated",
    appDeadline: d.appDeadline?.date ?? "", appDeadlineSure: d.appDeadline?.sure ?? "estimated", notifyDate: d.notifyDate ?? "", applyUrl: d.applyUrl ?? "", payNotes: d.payNotes ?? "", notes: d.notes ?? "",
  }),
  build: (v: Values) => ({
    label: v.label, year: Number(v.year), startDate: opt(v.startDate ?? ""), endDate: opt(v.endDate ?? ""),
    appOpens: v.appOpens ? { date: v.appOpens, sure: v.appOpensSure } : undefined, appDeadline: v.appDeadline ? { date: v.appDeadline, sure: v.appDeadlineSure } : undefined,
    notifyDate: opt(v.notifyDate ?? ""), applyUrl: opt(v.applyUrl ?? ""), payNotes: opt(v.payNotes ?? ""), notes: opt(v.notes ?? ""),
  }),
};
export const contactForm = {
  fields: [
    { key: "name", label: "Name", required: true, half: true }, { key: "title", label: "Role", half: true },
    { key: "emails", label: "Emails (comma separated, first is primary)" }, { key: "phones", label: "Phones (comma separated)", half: true },
    { key: "instagram", label: "Instagram", half: true }, { key: "notes", label: "Notes", type: "textarea" },
  ] as Field[],
  blank: {} as Values,
  initial: (d: Contact): Values => ({ name: d.name, title: d.title ?? "", emails: d.emails.join(", "), phones: d.phones.join(", "), instagram: d.instagram ?? "", notes: d.notes ?? "" }),
  build: (v: Values) => ({ name: v.name, title: opt(v.title ?? ""), emails: list(v.emails ?? ""), phones: list(v.phones ?? ""), instagram: opt(v.instagram ?? ""), notes: opt(v.notes ?? "") }),
};

/** Turn builder output into a patch: undefined means clear. */
export const toPatch = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v]));

/** A place's people: copy emails in one tap, link an existing contact, or add a new one. */
export function ContactsPanel({ kind, parentId, contactIds, contacts }: {
  kind: "venues" | "promoters" | "festivals"; parentId: string; contactIds: string[]; contacts: Row<Contact>[];
}) {
  const { call, error, busy } = useCommand();
  const hasDraft = useHasDraft(draftPath.newUnder(kind, parentId, "contacts"));
  const [explicit, setAdding] = useState<boolean | null>(null);
  const adding = explicit ?? hasDraft; // an unfinished contact opens the form
  const mine = contactIds.map((id) => contacts.find((c) => c.id === id)).filter((c): c is Row<Contact> => !!c);
  const others = contacts.filter((c) => !contactIds.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="grid gap-2" data-testid="contacts-panel">
      <span className="lbl">Contacts</span>
      <ErrorBox error={error} />
      {mine.length === 0 && <span className="s">No one yet.</span>}
      {mine.map((c) => (
        <div key={c.id} className="card" data-testid={`contact-${c.name}`}>
          <div className="flex items-center justify-between gap-2">
            <Link href={hrefFor("contact", c.id)} className="font-bold">{c.name}</Link>
            <button className="btn danger sm" disabled={busy} onClick={() => call("contacts.detach", { contactId: c.id, kind, id: parentId })}>Remove</button>
          </div>
          {c.title && <span className="s">{c.title}</span>}
          {c.emails.map((e) => (
            <div key={e} className="flex items-center justify-between gap-2"><span className="font-mono text-sm break-all">{e}</span><CopyButton text={e} /></div>
          ))}
        </div>
      ))}
      <div className="flex gap-2">
        {others.length > 0 && (
          <select className="select" value="" data-testid="contact-link" onChange={(e) => e.target.value && call("contacts.attach", { contactId: e.target.value, kind, id: parentId })}>
            <option value="">Link an existing contact…</option>
            {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <button className="btn ghost" onClick={() => setAdding(!adding)} data-testid="contact-new">{adding ? "Close" : "New contact"}</button>
      </div>
      {adding && (
        <EntityForm testid="contact-form" fields={contactForm.fields} initial={contactForm.blank} build={contactForm.build} submitLabel="Add contact"
          draft={{ path: draftPath.newUnder(kind, parentId, "contacts"), title: (v) => `New contact${v.name ? ` · ${v.name}` : ""}` }}
          onSubmit={async (d, meta) => { const r = await call("contacts.create", { ...d, attachTo: { kind, id: parentId } }, meta); if (r) setAdding(false); return !!r; }} />
      )}
    </div>
  );
}

export function PitchLinks({ pitches }: { pitches: PitchRow[] }) {
  if (!pitches.length) return <span className="s">None yet.</span>;
  return (
    <div className="grid gap-2">
      {pitches.map((p) => (
        <Link key={p.id} href={`/booking/pitches/${p.id}`} className="card" data-testid={`pitch-link-${p.id}`}>
          <div className="flex items-center justify-between gap-2"><b>{p.target.name}</b><StatusChip status={p.status} /></div>
          {p.nextStep && <span className="s">Next: {p.nextStep.text} · {p.nextStep.due}</span>}
        </Link>
      ))}
    </div>
  );
}

export function useNotFound<T>(loading: boolean, d: T | null, what: string) {
  if (loading) return <div className="s">Loading…</div>;
  if (!d) return <div className="card" data-testid="not-found">That {what} isn&apos;t here any more. <Link href="/booking" className="font-bold">Back to Booking</Link></div>;
  return null;
}
