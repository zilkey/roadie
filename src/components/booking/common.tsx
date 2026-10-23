"use client";
import { draftPath } from "@/schema/drafts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { STATUS_LABEL, isActive, type Status } from "@/lib/booking";
import { useCommand, ErrorBox } from "@/components/ui";
import { SaveStatus } from "@/components/SaveStatus";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useAutosave } from "@/lib/autosave";
import { useDraft, useHasDraft } from "@/lib/drafts";
import { newMutationId, type CommandMeta } from "@/lib/commands";
import type { Venue, Promoter, Festival, Edition, Contact, Pitch } from "@/schema";

export type PitchRow = Row<Omit<Pitch, "createdAt" | "updatedAt" | "deletedAt" | "lastContactAt">> & { lastContactAt?: { toMillis(): number } };

/** All booking collections, live. Small data set, so every page just loads what it needs. */
export function useBooking() {
  const venues = useCollection<Venue>("venues");
  const promoters = useCollection<Promoter>("promoters");
  const festivals = useCollection<Festival>("festivals");
  const editions = useCollection<Edition>("editions");
  const contacts = useCollection<Contact>("contacts");
  const pitches = useCollection<PitchRow>("pitches");
  return {
    venues: venues.rows ?? [], promoters: promoters.rows ?? [], festivals: festivals.rows ?? [],
    editions: editions.rows ?? [], contacts: contacts.rows ?? [], pitches: pitches.rows ?? [],
    loading: [venues, promoters, festivals, editions, contacts, pitches].some((c) => c.loading),
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

/** Flag = add to the Pitch List (one tap). Filled flag = already there; tapping it opens the pitch. */
export function FlagButton({ kind, id, pitches, big }: { kind: "venue" | "promoter" | "edition"; id: string; pitches: PitchRow[]; big?: boolean }) {
  const { call, error, busy } = useCommand();
  const router = useRouter();
  const open = pitches.find((p) => p.target.kind === kind && p.target.id === id && isActive(p.status));
  async function tap(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (open) return router.push(`/booking/pitches/${open.id}`);
    await call("pitches.flag", { kind, id });
  }
  return (
    <>
      <button type="button" onClick={tap} disabled={busy} data-testid={`flag-${id}`} data-flagged={open ? "1" : "0"}
        aria-label={open ? "On the Pitch List" : "Add to Pitch List"} aria-pressed={!!open}
        className={big ? `btn ${open ? "ghost" : "acc"}` : `btn sm ${open ? "acc" : "ghost"}`}>
        <FlagIcon filled={!!open} />{big && (open ? "On the Pitch List" : "Add to Pitch List")}
      </button>
      {error && <ErrorBox error={error} />}
    </>
  );
}

export function Seg<T extends string>({ value, options, onChange, testid }: { value: T; options: [T, string][]; onChange(v: T): void; testid?: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" data-testid={testid}>
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} aria-pressed={value === v} data-testid={`${testid}-${v}`}
          className={`btn sm ${value === v ? "acc" : "ghost"}`}>{l}</button>
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
function FormFields({ fields, v, set, testid, onBlur }: { fields: Field[]; v: Values; set(k: string, val: string): void; testid: string; onBlur?(): void }) {
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
function changedKeys(build: (v: Values) => Record<string, unknown>, a: Values, b: Values) {
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

export const venueForm = {
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
    { key: "loadInNotes", label: "Load-in notes", type: "textarea" }, { key: "notes", label: "Notes", type: "textarea" },
  ] as Field[],
  blank: { type: "bar", region: "denver", city: "", state: "CO", ages: "", soundProvider: "" } as Values,
  initial: (d: Venue): Values => ({
    name: d.name, type: d.type, region: d.region, city: d.address.city, state: d.address.state, street: d.address.street ?? "", zip: d.address.zip ?? "",
    capacity: d.capacity?.toString() ?? "", ages: d.ages ?? "", soundProvider: d.sound?.provider ?? "", soundNotes: d.sound?.notes ?? "",
    website: d.website ?? "", instagram: d.instagram ?? "", loadInNotes: d.loadInNotes ?? "", notes: d.notes ?? "",
  }),
  build: (v: Values) => ({
    name: v.name, type: v.type, region: v.region, address: { city: v.city, state: v.state, street: opt(v.street ?? ""), zip: opt(v.zip ?? "") },
    capacity: num(v.capacity ?? ""), ages: opt(v.ages ?? ""), sound: v.soundProvider ? { provider: v.soundProvider, notes: opt(v.soundNotes ?? "") } : undefined,
    website: opt(v.website ?? ""), instagram: opt(v.instagram ?? ""), loadInNotes: opt(v.loadInNotes ?? ""), notes: opt(v.notes ?? ""),
  }),
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
            <button className="btn ghost sm" disabled={busy} onClick={() => call("contacts.detach", { contactId: c.id, kind, id: parentId })}>Remove</button>
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
        <button className="btn ghost sm" onClick={() => setAdding(!adding)} data-testid="contact-new">{adding ? "Close" : "New contact"}</button>
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
