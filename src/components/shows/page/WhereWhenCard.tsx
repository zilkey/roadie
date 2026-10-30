"use client";
import { useRef, useState } from "react";
import Link from "@/lib/artist";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { ErrorBox, useCommand } from "@/components/ui";
import { InlineValue, PencilButton } from "@/components/InlineValue";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosave } from "@/lib/autosave";
import { endsAt, fmtDuration, parseDuration, setLengthOf } from "@/lib/duration";
import { fmtTime, isOff, kindOf, showAddress, showCity, showName } from "@/lib/shows";
import { CalendarSend } from "@/components/CalendarSend";
import type { Contact, Edition, Venue } from "@/schema";
import type { ShowRow } from "../common";
import { UnfinishedPlaceholder } from "./kit";
import { DayOfContact } from "./DayOfContact";
import { ShowTourRow, useShowTour } from "./ShowTourRow";

type Where = "venue" | "house" | "festival";
type TimeKey = "loadIn" | "soundcheck" | "doors" | "showStart" | "set";
const TIMES: [TimeKey, string][] = [["loadIn", "Load in"], ["soundcheck", "Soundcheck"], ["doors", "Doors"], ["showStart", "Show starts"], ["set", "Set"]];

/** The pencil form: only where the show is and when. Times and the day-of contact edit in place. */
interface Form { where: Where; venueId: string; hostContactIds: string[]; city: string; address: string; editionId: string; date: string }

const whereOf = (s: ShowRow): Where => { const k = kindOf(s); return k === "house" ? "house" : k === "festival" ? "festival" : "venue"; };

function formOf(s: ShowRow): Form {
  return {
    where: whereOf(s), venueId: s.venue?.id ?? "", hostContactIds: s.hostContactIds ?? [], city: s.place?.city ?? "", address: s.place?.address ?? "",
    editionId: s.editionId ?? "", date: s.date,
  };
}

/** Why this combination can't be saved yet, or null. */
function problemOf(f: Form): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return "Pick a date.";
  if (f.where !== "house" && !f.venueId && !f.editionId) return "Choose a venue, or the festival if the venue is TBD.";
  if (f.where === "house" && !f.city.trim()) return "Add the city.";
  return null;
}

/** The shows.update patch that takes `was` to `f` (kind, venueId, place, hostContactIds, editionId, date). */
function patchOf(was: Form, f: Form): Record<string, unknown> {
  const ne = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  const patch: Record<string, unknown> = {};
  if (f.where !== was.where) patch.kind = f.where;
  if (f.where === "house") {
    if (was.where !== "house") patch.venueId = null;
    const place = { city: f.city.trim(), ...(f.address.trim() ? { address: f.address.trim() } : {}) };
    if (was.where !== "house" || ne(place, { city: was.city.trim(), ...(was.address.trim() ? { address: was.address.trim() } : {}) })) patch.place = place;
    if (was.where !== "house" || ne(f.hostContactIds, was.hostContactIds)) patch.hostContactIds = f.hostContactIds;
  } else {
    if (f.venueId !== was.venueId) patch.venueId = f.venueId || null;
    if (was.where === "house") { patch.place = null; patch.hostContactIds = []; }
  }
  if (f.editionId !== was.editionId) patch.editionId = f.editionId || null;
  if (f.date !== was.date) patch.date = f.date;
  return patch;
}

const mapsUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const venueAddress = (v?: Row<Venue>) => (v ? [v.address.street, v.address.city, v.address.state].filter(Boolean).join(", ") : "");
const L = ({ children }: { children: React.ReactNode }) => <span className="lbl">{children}</span>;

/** The show's times as shows.update takes them, with one key changed ("" removes it). */
function timesWith(s: ShowRow, change: Partial<Record<TimeKey, string>> & { setLengthSec?: number | null }) {
  const t: Record<string, string | number> = {};
  for (const [k] of TIMES) { const v = k in change ? change[k] : s.times[k]; if (v) t[k] = v; }
  const sec = "setLengthSec" in change ? change.setLengthSec : setLengthOf(s.times);
  if (sec) t.setLengthSec = sec;
  return t;
}

/** Where & when: venue, address (Google Maps), times, day-of contact, calendar. Admins change the venue and date behind the pencil; everything else edits in place. */
export function WhereWhenCard({ show, admin }: { show: ShowRow; admin: boolean }) {
  const { call, error: cmdError, setError } = useCommand();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(() => formOf(show));
  const [problem, setProblem] = useState<string | null>(null);
  const [addingTimes, setAddingTimes] = useState(false);
  // The last valid form sent to autosave: each change sends only what differs from it.
  const sent = useRef<Form>(form);
  const as = useAutosave({ command: "shows.update", id: show.id, rev: show.rev, scope: "where-when", title: showName(show) });

  // Admin-only reads (rules): venues are readable by all, contacts and editions by admins. Only while the form is open.
  const venues = useCollection<Venue>("venues", { skip: !editing });
  const contacts = useCollection<Contact>("contacts", { skip: !admin || !editing });
  const editions = useCollection<Edition>("editions", { skip: !admin || !editing });
  const venue = (venues.rows ?? []).find((v) => v.id === form.venueId);

  function start() {
    const f = formOf(show);
    sent.current = f; setForm(f); setProblem(null); setEditing(true);
  }
  function done() { void as.flush(); setEditing(false); setProblem(null); }
  function set(p: Partial<Form>) {
    const next = { ...form, ...p };
    setForm(next);
    const why = problemOf(next);
    setProblem(why);
    if (why) return;
    const patch = patchOf(sent.current, next);
    sent.current = next;
    as.patch(patch);
  }

  async function saveTimes(change: Parameters<typeof timesWith>[1]): Promise<boolean> {
    setError(null);
    return (await call("shows.update", { id: show.id, patch: { times: timesWith(show, change) } })) !== undefined;
  }

  const tourInfo = useShowTour(show, admin);
  async function pickTour(next: string): Promise<boolean> {
    setError(null);
    if (next === (show.tourId ?? "")) return true;
    const r = next ? await call("tours.addShow", { tourId: next, showId: show.id }) : await call("tours.removeItem", { tourId: show.tourId, showId: show.id });
    return r !== undefined;
  }

  // ---------- view ----------
  const t = show.times;
  const len = setLengthOf(t);
  const addr = showAddress(show);
  const city = showCity(show);
  const mapQ = addr ?? (city ? `${showName(show)} ${city}` : showName(show));
  const mapLabel = addr ?? city;
  const nothing = !t.loadIn && !t.soundcheck && !t.doors && !t.showStart && !t.set && !len;
  const setText = t.set ? (len ? `${fmtTime(t.set)} – ${endsAt(t.set, len).toLowerCase()}` : fmtTime(t.set)) : "";
  const nameEl = show.venue
    ? <Link href={`/booking/venues/${show.venue.id}`} className="text-[1.0625rem] font-bold" style={{ color: "var(--ink)" }} data-testid="where-venue">{show.venue.name}</Link>
    : <span className="text-[1.0625rem] font-bold" data-testid="where-venue">{show.editionId && kindOf(show) !== "house" ? "Venue TBD" : showName(show)}</span>;

  const arrives = tourInfo.arrival && <span className="s d-muted" data-testid="where-arrival"> · arriving {fmtTime(tourInfo.arrival)} from the tour&apos;s drive</span>;
  const cell = (k: TimeKey, label: string) => (
    <div key={k} className="grid min-w-0 content-start gap-0.5"><span className="lbl">{label}</span>
      <InlineValue testid={`where-${k}`} label={label} kind="time" value={t[k] ?? ""} canEdit={admin} autoStart={addingTimes && k === "loadIn" && nothing}
        display={<b>{k === "set" ? setText : fmtTime(t[k] ?? "")}</b>} emptyLabel="Add…" className="self-start"
        onSave={(v) => saveTimes({ [k]: v })} error={cmdError} />
      {k === "loadIn" && t.loadIn && arrives}
    </div>
  );

  const f = form;
  return (
    <section className={`card${editing ? " editing" : ""}`} data-testid="where-when" data-editing={editing ? "1" : undefined}>
      <div className="card-head">
        <div className="flex flex-wrap items-center gap-2.5"><h2>Where &amp; when</h2></div>
        {editing ? <span className="tag">Editing</span>
          : admin && <PencilButton label="Change venue or date" onClick={start} testid="where-when-edit" />}
      </div>
      <div className="grid gap-4">
        {!editing ? (
          <div className="grid gap-1">
            {nameEl}
            {mapLabel && <a href={mapsUrl(mapQ)} target="_blank" rel="noopener noreferrer" data-testid="where-maps">{mapLabel} · Open in Google Maps ↗</a>}
          </div>
        ) : (
          <>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <label className="grid gap-1"><L>Where</L>
                <select className="select" value={f.where} onChange={(e) => set({ where: e.target.value as Where })} data-testid="where-kind">
                  <option value="venue">Venue</option><option value="house">Private event</option><option value="festival">Festival / Series</option>
                </select></label>
              <label className="grid gap-1"><L>Date</L>
                <input className="input" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} data-testid="where-date" /></label>
            </div>
            {f.where === "house" ? <HostFields f={f} set={set} contacts={contacts.rows ?? []} /> : (
              <label className="grid gap-1"><L>Venue</L>
                <select className="select" value={f.venueId} onChange={(e) => set({ venueId: e.target.value })} data-testid="where-venue-select">
                  <option value="">{f.editionId ? "Venue TBD" : "Choose a venue…"}</option>
                  {f.venueId && !venue && show.venue && <option value={f.venueId}>{show.venue.name}</option>}
                  {[...(venues.rows ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((v) => <option key={v.id} value={v.id}>{v.name} · {v.address.city}</option>)}
                </select>
                {venue && <span className="s" data-testid="where-venue-hint">{venueAddress(venue)} — from the venue record · <a href={mapsUrl(venueAddress(venue) || venue.name)} target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a></span>}
              </label>
            )}
            <label className="grid gap-1"><L>Part of a festival or series</L>
              <select className="select" value={f.editionId} onChange={(e) => set({ editionId: e.target.value })} data-testid="where-edition">
                <option value="">No</option>
                {f.editionId && !(editions.rows ?? []).some((e) => e.id === f.editionId) && <option value={f.editionId}>{show.editionName ?? "Current"}</option>}
                {[...(editions.rows ?? [])].sort((a, b) => `${a.festivalName} ${a.label}`.localeCompare(`${b.festivalName} ${b.label}`))
                  .map((e) => <option key={e.id} value={e.id}>{e.festivalName} {e.label}</option>)}
              </select></label>
            <ErrorBox error={problem} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SaveStatus {...as.statusProps} />
              <button type="button" className="btn acc" onClick={done} data-testid="where-when-done">Done</button>
            </div>
            <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: 0 }} />
          </>
        )}
        {nothing && !addingTimes ? (
          <UnfinishedPlaceholder testid="where-no-times" lead="No times yet."
            actions={admin ? <button type="button" className="btn ghost sm" onClick={() => setAddingTimes(true)} data-testid="where-add-times">Add times</button> : undefined}>
            Add load-in, soundcheck, doors and set time so everyone knows when to show up.
          </UnfinishedPlaceholder>
        ) : (
          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="where-times">
              {cell("loadIn", "Load in")}{cell("soundcheck", "Soundcheck")}{cell("doors", "Doors")}
              {t.showStart ? cell("showStart", "Show starts") : null}
              {cell("set", "Set")}
              <div className="grid min-w-0 content-start gap-0.5"><span className="lbl">Set length</span>
                <InlineValue testid="where-length" label="Set length" kind="text" value={len ? fmtDuration(len) : ""} canEdit={admin} placeholder="2h, 2:30, 90m"
                  display={<b>{len ? fmtDuration(len) : ""}</b>} className="self-start"
                  validate={(v) => (v && parseDuration(v) === null ? "Couldn't read that. Try 2h, 2:30 or 90m." : null)}
                  onSave={(v) => saveTimes({ setLengthSec: v ? parseDuration(v) : null })} error={cmdError} />
              </div>
            </div>
            {addingTimes && admin && <span className="s" data-testid="where-times-hint">Tab moves to the next time. Each one saves as you leave it.</span>}
          </div>
        )}
        {!editing && <ShowTourRow show={show} admin={admin} info={tourInfo} onPick={pickTour} />}
        <DayOfContact show={show} admin={admin} />
        {!editing && (
          <div className="s flex flex-wrap items-center gap-x-5 gap-y-1" data-testid="where-foot">
            <CalendarSend kind="shows" id={show.id} eventId={show.calendarEventId} admin={admin} off={isOff(show)} testid="where-calendar" />
          </div>
        )}
      </div>
    </section>
  );
}

/** Private event: who hosts (contacts) and where. The address stays with the band. */
function HostFields({ f, set, contacts }: { f: Form; set(p: Partial<Form>): void; contacts: Row<Contact>[] }) {
  const hosts = f.hostContactIds.map((id) => contacts.find((c) => c.id === id)).filter((c): c is Row<Contact> => !!c);
  const others = contacts.filter((c) => !f.hostContactIds.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="grid gap-3">
      <L>Hosts</L>
      <div className="flex flex-wrap gap-1.5" data-testid="where-hosts">
        {hosts.map((c) => <button key={c.id} type="button" className="btn sm acc" aria-label={`Remove ${c.name}`} onClick={() => set({ hostContactIds: f.hostContactIds.filter((x) => x !== c.id) })}>{c.name} ×</button>)}
        {!hosts.length && <span className="s">No host yet.</span>}
      </div>
      <select className="select" value="" aria-label="Add a host" data-testid="where-host-add" onChange={(e) => e.target.value && set({ hostContactIds: [...f.hostContactIds, e.target.value] })}>
        <option value="">Add a host from contacts…</option>
        {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className="grid gap-1"><L>City</L><input className="input" value={f.city} onChange={(e) => set({ city: e.target.value })} data-testid="where-city" /></label>
        <label className="grid gap-1"><L>Address (band only)</L><input className="input" value={f.address} onChange={(e) => set({ address: e.target.value })} data-testid="where-address" /></label>
      </div>
    </div>
  );
}
