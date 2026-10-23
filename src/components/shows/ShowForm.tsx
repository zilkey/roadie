"use client";
import { useState } from "react";
import { ErrorBox } from "@/components/ui";
import { Seg } from "@/components/booking/common";
import { dollarsToCents } from "@/lib/money";
import type { Row } from "@/lib/firestore-hooks";
import type { Artist, Musician, Venue } from "@/schema";

export interface ShowFormState {
  venueId: string; date: string; status: "hold" | "confirmed" | "played" | "canceled";
  loadIn: string; soundcheck: string; doors: string; set: string; setLength: string;
  billedAs: string; personnel: string[]; soundProvider: "venueProvided" | "bandProvided"; soundNotes: string;
  poster: boolean; backline: boolean; merch: boolean; calendar: boolean; public: boolean; ticketUrl: string; bandNotes: string;
  dealType: "guarantee" | "doorSplit" | "flat" | "tips" | "free"; guarantee: string; doorSplitPct: string; ticketPrice: string;
}

export function timesOf(s: ShowFormState) {
  const t: Record<string, string | number> = {};
  for (const k of ["loadIn", "soundcheck", "doors", "set"] as const) if (s[k]) t[k] = s[k];
  if (s.setLength) t.setLength = Number(s.setLength);
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
/**
 * The `shows.update` patch for ONE edit: only the fields that differ between the form before (`a`) and after (`b`).
 * Diffing consecutive form states (not form vs. the live show) is what makes A -> B -> A save correctly while the
 * live document is still catching up. Invalid half-typed values (no venue, partial date) are left out.
 */
export function showPatch(a: ShowFormState, b: ShowFormState): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const ne = (x: unknown, y: unknown) => JSON.stringify(x) !== JSON.stringify(y);
  if (b.venueId !== a.venueId && b.venueId) p.venueId = b.venueId;
  if (b.date !== a.date && DATE.test(b.date)) p.date = b.date;
  if (b.status !== a.status) p.status = b.status;
  if (ne(timesOf(a), timesOf(b))) p.times = timesOf(b);
  if (b.billedAs !== a.billedAs) p.billedAs = b.billedAs || null;
  if (ne([...a.personnel].sort(), [...b.personnel].sort())) p.personnel = b.personnel;
  if (b.soundProvider !== a.soundProvider || b.soundNotes !== a.soundNotes) p.sound = { provider: b.soundProvider, ...(b.soundNotes.trim() ? { notes: b.soundNotes.trim() } : {}) };
  if (b.soundProvider !== a.soundProvider) p.rebuildGear = true;
  if (b.poster !== a.poster || b.backline !== a.backline || b.merch !== a.merch) p.needs = { poster: b.poster, backline: b.backline, merch: b.merch };
  if (b.public !== a.public) p.public = b.public;
  if (b.ticketUrl !== a.ticketUrl) p.ticketUrl = b.ticketUrl || null;
  if (b.bandNotes !== a.bandNotes) p.bandNotes = b.bandNotes.trim() || null;
  return p;
}

const L = ({ children }: { children: React.ReactNode }) => <span className="lbl">{children}</span>;

/** Shared by "New show" (Booked it) and editing a show. Controlled by the parent so it can diff what changed. */
export function ShowForm({ mode, value, onChange, onBlur, venues, artist, musicians, error, busy, submitLabel, onSubmit, onCancel }: {
  mode: "create" | "edit"; value: ShowFormState; onChange(v: ShowFormState): void; venues: Row<Venue>[]; artist?: Row<Artist>; musicians: Row<Musician>[];
  error: string | null; busy: boolean;
  /** Edit mode (autosave): leave out onSubmit, there is no Save button. Called when focus leaves a field. */
  onBlur?(): void;
  /** Create mode: the explicit button ("Add show"). */
  submitLabel?: string; onSubmit?(): void; onCancel?(): void;
}) {
  const [soundTouched, setSoundTouched] = useState(mode === "edit");
  const set = (p: Partial<ShowFormState>) => onChange({ ...value, ...p });
  const venue = venues.find((v) => v.id === value.venueId);
  const field = (k: keyof ShowFormState, label: string, type = "text", testid?: string) => (
    <label className="grid gap-1"><L>{label}</L>
      <input className="input" type={type} value={value[k] as string} onChange={(e) => set({ [k]: e.target.value } as Partial<ShowFormState>)} data-testid={testid ?? `show-${k}`} />
    </label>
  );
  return (
    <form className="grid gap-3" data-testid="show-form" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }} onBlur={onBlur}>
      <div className="card">
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
        {field("date", "Date", "date")}
        <Seg testid="status" value={value.status === "hold" ? "hold" : value.status} onChange={(v) => set({ status: v })}
          options={[["confirmed", "Confirmed"], ["hold", "Hold"]]} />
        <div className="grid grid-cols-2 gap-2">
          {field("loadIn", "Load in", "time")}{field("soundcheck", "Soundcheck", "time")}
          {field("doors", "Doors", "time")}{field("set", "Set", "time")}
        </div>
        {field("setLength", "Set length (minutes)", "number", "show-length")}
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
            return <button key={m.id} type="button" aria-pressed={on} data-testid={`play-${m.name}`} className={`btn sm ${on ? "acc" : "ghost"}`}
              onClick={() => set({ personnel: on ? value.personnel.filter((x) => x !== m.id) : [...value.personnel, m.id] })}>{m.name}</button>;
          })}
        </div>
        <span className="s">Filling in from the configuration. Tap to change anyone.</span>
      </div>

      <div className="card">
        <L>Sound</L>
        <Seg testid="sound" value={value.soundProvider} onChange={(v) => { setSoundTouched(true); set({ soundProvider: v }); }}
          options={[["venueProvided", "Venue provides"], ["bandProvided", "We bring it"]]} />
        {venue?.sound && !soundTouched && <span className="s">From {venue.name}.</span>}
        {field("soundNotes", "Sound notes", "text", "sound-notes")}
        <L>We need</L>
        {(["poster", "backline", "merch"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value[k]} data-testid={`need-${k}`} onChange={(e) => set({ [k]: e.target.checked })} />
            {k === "poster" ? "Posters" : k === "backline" ? "Backline" : "Merch table"}</label>
        ))}
        {mode === "create" && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.calendar} data-testid="show-calendar" onChange={(e) => set({ calendar: e.target.checked })} />Add to everyone&apos;s calendar</label>
        )}
      </div>

      <div className="card">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.public} data-testid="show-public" onChange={(e) => set({ public: e.target.checked })} />Public show (list on Bandsintown when confirmed)</label>
        {value.public && field("ticketUrl", "Ticket link", "url", "show-ticket")}
        <label className="grid gap-1"><L>Notes for the band</L>
          <textarea className="input" rows={3} placeholder="Parking, dress, food" value={value.bandNotes} onChange={(e) => set({ bandNotes: e.target.value })} data-testid="show-notes" />
        </label>
      </div>

      {mode === "create" && (
        <div className="card" data-testid="deal-fields">
          <L>Deal (only admins see this)</L>
          <select className="select" value={value.dealType} onChange={(e) => set({ dealType: e.target.value as ShowFormState["dealType"] })} data-testid="deal-type">
            <option value="guarantee">Guarantee</option><option value="doorSplit">Door split</option><option value="flat">Flat fee</option><option value="tips">Tips</option><option value="free">Free</option>
          </select>
          {value.dealType === "guarantee" && field("guarantee", "Guarantee ($)", "number", "deal-guarantee")}
          {value.dealType === "doorSplit" && field("doorSplitPct", "Our share of the door (%)", "number", "deal-split")}
          {(value.dealType === "doorSplit") && field("ticketPrice", "Ticket price ($)", "number", "deal-ticket")}
        </div>
      )}

      <ErrorBox error={error} />
      {onSubmit && (
        <div className="flex gap-2">
          <button className="btn acc" disabled={busy || !value.venueId || !value.date} data-testid="show-save">{submitLabel ?? "Save"}</button>
          {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
        </div>
      )}
    </form>
  );
}
