"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { STATUS_LABEL, isActive, type Status } from "@/lib/booking";
import { useCommand, ErrorBox } from "@/components/ui";
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

/** `build` turns form values into command input; undefined fields are sent as null on edit (cleared). */
export function EntityForm({ fields, initial, build, submitLabel, onSubmit, testid, onCancel }: {
  fields: Field[]; initial: Values; build(v: Values): Record<string, unknown>; submitLabel: string;
  onSubmit(data: Record<string, unknown>): Promise<boolean | void>; testid: string; onCancel?(): void; // onSubmit resolves true to reset the form (create forms)
}) {
  const [v, setV] = useState<Values>(initial);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { if ((await onSubmit(build(v))) === true) setV(initial); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="card" data-testid={testid}>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((f) => (
          <label key={f.key} className={`grid gap-1 ${f.half ? "" : "col-span-2"}`}>
            <span className="lbl">{f.label}{f.required ? " *" : ""}</span>
            {f.type === "textarea" ? (
              <textarea className="input" rows={3} value={v[f.key] ?? ""} placeholder={f.placeholder} data-testid={`${testid}-${f.key}`} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
            ) : f.type === "select" ? (
              <select className="select" value={v[f.key] ?? ""} data-testid={`${testid}-${f.key}`} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}>
                {f.options!.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
              </select>
            ) : (
              <input className="input" type={f.type ?? "text"} required={f.required} value={v[f.key] ?? ""} placeholder={f.placeholder}
                data-testid={`${testid}-${f.key}`} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
            )}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button className="btn acc" disabled={busy} data-testid={`${testid}-submit`}>{submitLabel}</button>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
      </div>
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
  const [adding, setAdding] = useState(false);
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
          onSubmit={async (d) => { const r = await call("contacts.create", { ...d, attachTo: { kind, id: parentId } }); if (r) setAdding(false); return !!r; }} />
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
