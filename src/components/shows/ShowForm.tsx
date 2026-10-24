"use client";
import { useState } from "react";
import { ErrorBox, PickChip, Select } from "@/components/ui";
import { dollarsToCents } from "@/lib/money";
import { describeDuration, endsAt, parseDuration } from "@/lib/duration";
import type { Row } from "@/lib/firestore-hooks";
import type { Artist, Contact, Edition, Musician, Venue } from "@/schema";

export interface ShowFormState {
  /** A venue, or a house concert: hosts (contacts) + city and address, no venue. */
  where: "venue" | "house"; venueId: string; hostContactIds: string[]; city: string; address: string;
  /** The festival year this show is part of ("" = none). */
  editionId: string;
  date: string; status: "hold" | "confirmed" | "played" | "canceled" | "dropped";
  loadIn: string; soundcheck: string; doors: string; showStart: string; set: string;
  /** Typed as text ("2h", "2:30", "90m"); read with parseDuration. */
  setLength: string;
  billedAs: string; personnel: string[]; soundProvider: "venueProvided" | "bandProvided"; soundNotes: string;
  poster: boolean; backline: boolean; merch: boolean; calendar: boolean;
  dealType: "guarantee" | "doorSplit" | "flat" | "tips" | "free"; guarantee: string; doorSplitPct: string; ticketPrice: string;
}

export function timesOf(s: ShowFormState) {
  const t: Record<string, string | number> = {};
  for (const k of ["loadIn", "soundcheck", "doors", "showStart", "set"] as const) if (s[k]) t[k] = s[k];
  const sec = parseDuration(s.setLength);
  if (sec) t.setLengthSec = sec;
  return t;
}
export function dealOf(s: ShowFormState) {
  return {
    deal: s.dealType,
    ...(s.dealType === "guarantee" && s.guarantee ? { guarantee: dollarsToCents(s.guarantee) } : {}),
    ...(s.dealType === "doorSplit" && s.doorSplitPct ? { doorSplitPct: Number(s.doorSplitPct) } : {}),
    ...(s.ticketPrice ? { ticketPrice: dollarsToCents(s.ticketPrice) } : {}),
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The form has somewhere to put the show: a venue, or a city for a house concert. */
export const hasPlace = (s: ShowFormState) => (s.where === "venue" ? !!s.venueId : !!s.city.trim());
export const placeOf = (s: ShowFormState) => ({ city: s.city.trim(), ...(s.address.trim() ? { address: s.address.trim() } : {}) });
/** The where-fields of `shows.create`. */
export function whereInput(s: ShowFormState) {
  return s.where === "venue"
    ? { venueId: s.venueId, ...(s.editionId ? { kind: "festival" as const } : {}) }
    : { kind: "house" as const, place: placeOf(s), hostContactIds: s.hostContactIds };
}
const L = ({ children }: { children: React.ReactNode }) => <span className="lbl">{children}</span>;

/** The "New show" (Booked it) form. Controlled by the parent. */
export function ShowForm({ value, onChange, venues, contacts, editions, artist, musicians, error, busy, submitLabel, onSubmit, onCancel, dateSlot }: {
  value: ShowFormState; onChange(v: ShowFormState): void; venues: Row<Venue>[];
  /** House concert hosts are picked from contacts; festival years from editions. */
  contacts: Row<Contact>[]; editions: Row<Edition>[];
  artist?: Row<Artist>; musicians: Row<Musician>[];
  error: string | null; busy: boolean;
  /** The explicit button ("Add show"): a draft never creates a show by itself. */
  submitLabel?: string; onSubmit?(): void; onCancel?(): void;
  /** Replaces the single Date field (a pitch with several dates picks which become shows). */
  dateSlot?: React.ReactNode;
}) {
  const [soundTouched, setSoundTouched] = useState(false);
  const set = (p: Partial<ShowFormState>) => onChange({ ...value, ...p });
  const venue = venues.find((v) => v.id === value.venueId);
  const lengthSec = parseDuration(value.setLength);
  const lengthBad = !!value.setLength.trim() && lengthSec === null;
  const field = (k: keyof ShowFormState, label: string, type = "text", testid?: string) => (
    <label className="grid gap-1"><L>{label}</L>
      <input className="input" type={type} value={value[k] as string} onChange={(e) => set({ [k]: e.target.value } as Partial<ShowFormState>)} data-testid={testid ?? `show-${k}`} />
    </label>
  );
  return (
    <form className="grid gap-3" data-testid="show-form" onSubmit={(e) => { e.preventDefault(); if (!lengthBad) onSubmit?.(); }}>
      <div className="card">
        <label className="grid gap-1"><L>Where</L>
          <Select testid="show-where" value={value.where}
            onChange={(w) => set({ where: w, ...(!soundTouched && w === "house" ? { soundProvider: "bandProvided" } : {}) })}
            options={[["venue", "Venue"], ["house", "House concert"]]} />
        </label>
        {value.where === "venue" ? (
          <label className="grid gap-1"><L>Venue</L>
            <select className="select" value={value.venueId} data-testid="show-venue" required
              onChange={(e) => {
                const v = venues.find((x) => x.id === e.target.value);
                set({ venueId: e.target.value, ...(!soundTouched && v?.sound ? { soundProvider: v.sound.provider, soundNotes: v.sound.notes ?? "" } : {}) });
              }}>
              <option value="">Choose a venue…</option>
              {[...venues].sort((a, b) => a.name.localeCompare(b.name)).map((v) => <option key={v.id} value={v.id}>{v.name} · {v.address.city}</option>)}
            </select>
          </label>
        ) : (
          <HostFields value={value} set={set} contacts={contacts} />
        )}
        <label className="grid gap-1"><L>Part of a festival</L>
          <select className="select" value={value.editionId} data-testid="show-edition" onChange={(e) => set({ editionId: e.target.value })}>
            <option value="">No</option>
            {[...editions].sort((a, b) => `${a.festivalName} ${a.label}`.localeCompare(`${b.festivalName} ${b.label}`))
              .map((e) => <option key={e.id} value={e.id}>{e.festivalName} {e.label}</option>)}
          </select>
        </label>
        {dateSlot ?? field("date", "Date", "date")}
        <label className="grid gap-1"><L>Status</L>
          <Select testid="status" value={value.status === "hold" ? "hold" : value.status} onChange={(v) => set({ status: v })}
            options={[["confirmed", "Confirmed"], ["hold", "Hold"]]} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          {field("loadIn", "Load in", "time")}{field("soundcheck", "Soundcheck", "time")}
          {field("doors", "Doors", "time")}{field("showStart", "Show starts", "time")}
          {field("set", "Set", "time")}
        </div>
        <label className="grid gap-1"><L>Set length</L>
          <input className="input" value={value.setLength} placeholder="2h, 2:30, 90m" onChange={(e) => set({ setLength: e.target.value })} data-testid="show-length" aria-invalid={lengthBad} />
        </label>
        {lengthBad && <span className="text-sm text-red-600" role="alert" data-testid="show-length-error">Couldn&apos;t read that. Try 2h, 2:30 or 90m.</span>}
        {lengthSec !== null && <span className="s" data-testid="show-length-says">{describeDuration(lengthSec)}{value.set ? ` · ends at ${endsAt(value.set, lengthSec)}` : ""}</span>}
      </div>

      <div className="card">
        <label className="grid gap-1"><L>Billed as</L>
          <select className="select" value={value.billedAs} data-testid="billed-as"
            onChange={(e) => {
              const c = artist?.configurations.find((x) => x.id === e.target.value);
              set({ billedAs: e.target.value, ...(c ? { personnel: c.musicianIds } : {}) });
            }}>
            <option value="">Not set</option>
            {artist?.configurations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <L>Who&apos;s playing</L>
        <div className="flex flex-wrap gap-1.5" data-testid="personnel">
          {musicians.filter((m) => m.active || value.personnel.includes(m.id)).sort((a, b) => a.name.localeCompare(b.name)).map((m) => {
            const on = value.personnel.includes(m.id);
            return <PickChip key={m.id} on={on} testid={`play-${m.name}`}
              onToggle={() => set({ personnel: on ? value.personnel.filter((x) => x !== m.id) : [...value.personnel, m.id] })}>{m.name}</PickChip>;
          })}
        </div>
        <span className="s">Filling in from the configuration. Tap to change anyone.</span>
      </div>

      <div className="card">
        <label className="grid gap-1"><L>Sound</L>
          <Select testid="sound" value={value.soundProvider} onChange={(v) => { setSoundTouched(true); set({ soundProvider: v }); }}
            options={[["venueProvided", "Venue provides"], ["bandProvided", "We bring it"]]} />
        </label>
        {venue?.sound && !soundTouched && <span className="s">From {venue.name}.</span>}
        {field("soundNotes", "Sound notes", "text", "sound-notes")}
        <L>We need</L>
        {(["poster", "backline", "merch"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value[k]} data-testid={`need-${k}`} onChange={(e) => set({ [k]: e.target.checked })} />
            {k === "poster" ? "Posters" : k === "backline" ? "Backline" : "Merch table"}</label>
        ))}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.calendar} data-testid="show-calendar" onChange={(e) => set({ calendar: e.target.checked })} />Add to everyone&apos;s calendar</label>
      </div>

      <div className="card" data-testid="deal-fields">
        <L>Deal (only admins see this)</L>
        <select className="select" value={value.dealType} onChange={(e) => set({ dealType: e.target.value as ShowFormState["dealType"] })} data-testid="deal-type">
          <option value="guarantee">Guarantee</option><option value="doorSplit">Door split</option><option value="flat">Flat fee</option><option value="tips">Tips</option><option value="free">Free</option>
        </select>
        {value.dealType === "guarantee" && field("guarantee", "Guarantee ($)", "number", "deal-guarantee")}
        {value.dealType === "doorSplit" && field("doorSplitPct", "Our share of the door (%)", "number", "deal-split")}
        {(value.dealType === "doorSplit") && field("ticketPrice", "Ticket price ($)", "number", "deal-ticket")}
      </div>

      <ErrorBox error={error} />
      {onSubmit && (
        <div className="flex gap-2">
          <button className="btn acc" disabled={busy || lengthBad || !hasPlace(value) || !value.date} data-testid="show-save">{submitLabel ?? "Save"}</button>
          {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
        </div>
      )}
    </form>
  );
}

/** House concert: who hosts (contacts) and where. The address stays with the band; it's never listed publicly. */
function HostFields({ value, set, contacts }: { value: ShowFormState; set(p: Partial<ShowFormState>): void; contacts: Row<Contact>[] }) {
  const hosts = value.hostContactIds.map((id) => contacts.find((c) => c.id === id)).filter((c): c is Row<Contact> => !!c);
  const others = contacts.filter((c) => !value.hostContactIds.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <L>Hosts</L>
      <div className="flex flex-wrap gap-1.5" data-testid="show-hosts">
        {hosts.map((c) => (
          <button key={c.id} type="button" className="btn sm acc" data-testid={`host-${c.id}`} aria-label={`Remove ${c.name}`}
            onClick={() => set({ hostContactIds: value.hostContactIds.filter((x) => x !== c.id) })}>{c.name} ×</button>
        ))}
        {!hosts.length && <span className="s">No host yet.</span>}
      </div>
      <select className="select" value="" data-testid="show-host-add" onChange={(e) => e.target.value && set({ hostContactIds: [...value.hostContactIds, e.target.value] })}>
        <option value="">Add a host from contacts…</option>
        {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1"><L>City</L>
          <input className="input" value={value.city} onChange={(e) => set({ city: e.target.value })} data-testid="show-city" required /></label>
        <label className="grid gap-1"><L>Address (band only)</L>
          <input className="input" value={value.address} onChange={(e) => set({ address: e.target.value })} data-testid="show-address-input" /></label>
      </div>
    </>
  );
}
