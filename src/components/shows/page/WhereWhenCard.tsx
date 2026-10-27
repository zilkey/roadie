"use client";
import { useRef, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { ErrorBox, useCommand } from "@/components/ui";
import { describeDuration, endsAt, fmtDuration, parseDuration, setLengthOf } from "@/lib/duration";
import { fmtTime, isOff, kindOf, showAddress, showCity, showName } from "@/lib/shows";
import { CalendarSend } from "@/components/CalendarSend";
import type { Contact, Edition, Venue, VenueNote } from "@/schema";
import { privateOf, roleFirst } from "@/lib/venues";
import type { ShowRow } from "../common";
import { EditableCard, UnfinishedPlaceholder, useCardEdit } from "./kit";

type Where = "venue" | "house" | "festival";
type TimeKey = "loadIn" | "soundcheck" | "doors" | "showStart" | "set";
const TIMES: [TimeKey, string][] = [["loadIn", "Load in"], ["soundcheck", "Soundcheck"], ["doors", "Doors"], ["showStart", "Show starts"], ["set", "Set starts"]];

interface Form {
  where: Where; venueId: string; hostContactIds: string[]; city: string; address: string; editionId: string; date: string;
  times: Record<TimeKey, string>; setLength: string;
  /** "" none, "c:<contactId>" a venue contact, "keep" the contact already on the show, "other" typed in (at a venue: a new venue contact). */
  dayOf: string; otherName: string; otherPhone: string;
}

const whereOf = (s: ShowRow): Where => { const k = kindOf(s); return k === "house" ? "house" : k === "festival" ? "festival" : "venue"; };
const lengthText = (s: ShowRow) => { const sec = setLengthOf(s.times); return sec ? fmtDuration(sec) : ""; };

function formOf(s: ShowRow): Form {
  const t = s.times;
  return {
    where: whereOf(s), venueId: s.venue?.id ?? "", hostContactIds: s.hostContactIds ?? [], city: s.place?.city ?? "", address: s.place?.address ?? "",
    editionId: s.editionId ?? "", date: s.date,
    times: { loadIn: t.loadIn ?? "", soundcheck: t.soundcheck ?? "", doors: t.doors ?? "", showStart: t.showStart ?? "", set: t.set ?? "" },
    setLength: lengthText(s),
    dayOf: s.dayOfContact ? (s.dayOfContact.contactId ? `c:${s.dayOfContact.contactId}` : "keep") : "",
    otherName: "", otherPhone: "",
  };
}

/** "+13035550142" -> "(303) 555-0142"; anything else as typed. */
function fmtPhone(p?: string) {
  if (!p) return "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p;
}
/** A typed phone number as E.164 for a contact, or null when it can't be one. */
function toE164(p: string): string | null {
  const d = p.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === "1") return `+${d}`;
  return null;
}
const mapsUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const venueAddress = (v?: Row<Venue>) => (v ? [v.address.street, v.address.city, v.address.state].filter(Boolean).join(", ") : "");
const L = ({ children }: { children: React.ReactNode }) => <span className="lbl">{children}</span>;

function timesOf(f: Form, sec: number | null) {
  const t: Record<string, string | number> = {};
  for (const [k] of TIMES) if (f.times[k]) t[k] = f.times[k];
  if (sec) t.setLengthSec = sec;
  return t;
}

/** Where & when: venue, address (Google Maps), times, day-of contact, calendar. Admins edit it. */
export function WhereWhenCard({ show, admin }: { show: ShowRow; admin: boolean }) {
  const { artistId } = useArtist();
  const { call, error: cmdError, busy, setError } = useCommand();
  const [form, setForm] = useState<Form>(() => formOf(show));
  const [localError, setLocalError] = useState<string | null>(null);
  const wantContact = useRef(false);
  const ed = useCardEdit({
    canEdit: admin,
    onStart: () => {
      const f = formOf(show);
      if (wantContact.current && !f.dayOf) f.dayOf = "other";
      wantContact.current = false;
      setForm(f); setLocalError(null); setError(null);
    },
  });
  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  // Admin-only reads (rules): venues are readable by all, the band's notes, contacts and editions by admins.
  const venues = useCollection<Venue>("venues", { skip: !ed.editing });
  const notes = useCollection<VenueNote>("venueNotes", { where: [["artistId", "==", artistId]], skip: !admin });
  const contacts = useCollection<Contact>("contacts", { skip: !admin });
  const editions = useCollection<Edition>("editions", { skip: !admin || !ed.editing });

  const venue = (venues.rows ?? []).find((v) => v.id === form.venueId);
  const venueNotes = privateOf((notes.rows ?? []).find((x) => x.venueId === form.venueId) ?? venue);
  // The venue's day-of contacts first, then its other people.
  const venueContacts = roleFirst(
    venueNotes.contactIds.map((id) => (contacts.rows ?? []).find((c) => c.id === id)).filter((c): c is Row<Contact> => !!c), venueNotes.dayOfContactIds,
  );
  const dayOfPeople = venueContacts.filter((c) => venueNotes.dayOfContactIds.includes(c.id));
  const contactGroups: [string, Row<Contact>[]][] = [
    ["Day-of contacts", dayOfPeople],
    [`${dayOfPeople.length ? "Other " : ""}${venue?.name ?? show.venue?.name ?? "Venue"} contacts`, venueContacts.filter((c) => !dayOfPeople.includes(c))],
  ];
  // At a venue a typed-in person becomes one of its contacts; a house concert or a festival with the venue TBD just keeps the name.
  const atVenue = form.where !== "house" && !!form.venueId;

  const sec = parseDuration(form.setLength);
  const lengthBad = !!form.setLength.trim() && sec === null;

  async function save(): Promise<boolean> {
    setLocalError(null);
    if (lengthBad) { setLocalError("Couldn't read the set length. Try 2h, 2:30 or 90m."); return false; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) { setLocalError("Pick a date."); return false; }
    if (form.where !== "house" && !form.venueId && !form.editionId) { setLocalError("Choose a venue, or the festival if the venue is TBD."); return false; }
    if (form.where === "house" && !form.city.trim()) { setLocalError("Add the city."); return false; }
    const was = formOf(show);
    const ne = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
    const patch: Record<string, unknown> = {};

    if (form.where !== was.where) patch.kind = form.where === "venue" ? "venue" : form.where;
    if (form.where === "house") {
      patch.venueId = null;
      const place = { city: form.city.trim(), ...(form.address.trim() ? { address: form.address.trim() } : {}) };
      if (was.where !== "house" || ne(place, { city: was.city, ...(was.address ? { address: was.address } : {}) })) patch.place = place;
      if (was.where !== "house" || ne(form.hostContactIds, was.hostContactIds)) patch.hostContactIds = form.hostContactIds;
      if (was.where === "house") delete patch.venueId;
    } else {
      if (form.venueId !== was.venueId) patch.venueId = form.venueId || null;
      if (was.where === "house") { patch.place = null; patch.hostContactIds = []; }
    }
    if (form.editionId !== was.editionId) patch.editionId = form.editionId || null;
    if (form.date !== was.date) patch.date = form.date;
    const times = timesOf(form, sec);
    if (ne(times, timesOf(was, setLengthOf(show.times) ?? null))) patch.times = times;

    // Day-of contact
    if (form.dayOf !== was.dayOf || form.dayOf === "other") {
      if (form.dayOf === "") { if (show.dayOfContact) patch.dayOfContact = null; }
      else if (form.dayOf.startsWith("c:")) {
        const c = venueContacts.find((x) => `c:${x.id}` === form.dayOf);
        if (c) patch.dayOfContact = { name: c.name, ...(c.phones[0] ? { phone: fmtPhone(c.phones[0]) } : {}), contactId: c.id };
      } else if (form.dayOf === "other") {
        const name = form.otherName.trim();
        if (!name) { setLocalError("Add the contact's name."); return false; }
        const phone = form.otherPhone.trim();
        let contactId: string | undefined;
        if (atVenue) {
          const e164 = phone ? toE164(phone) : null;
          if (phone && !e164) { setLocalError("That phone number doesn't look right. Use 10 digits, like (303) 555-0142."); return false; }
          const r = await call<{ id: string }>("contacts.create", { name, phones: e164 ? [e164] : [], emails: [], attachTo: { kind: "venues", id: form.venueId } });
          if (!r?.id) return false;
          contactId = r.id;
        }
        // shows.update ticks them as a day-of contact at the venue.
        patch.dayOfContact = { name, ...(phone ? { phone } : {}), ...(contactId ? { contactId } : {}) };
      }
    }

    if (!Object.keys(patch).length) return true;
    return !!(await call("shows.update", { id: show.id, patch }));
  }

  // ---------- view ----------
  const t = show.times;
  const len = setLengthOf(t);
  const addr = showAddress(show);
  const city = showCity(show);
  const mapQ = addr ?? (city ? `${showName(show)} ${city}` : showName(show));
  const mapLabel = addr ?? city;
  const nothing = !t.loadIn && !t.soundcheck && !t.doors && !t.showStart && !t.set && !len;
  const dash = <b className="font-normal text-[color:var(--muted)]">—</b>;
  const setText = t.set ? (len ? `${fmtTime(t.set)} – ${endsAt(t.set, len).toLowerCase()}` : fmtTime(t.set)) : null;
  const cell = (label: string, v?: string) => (
    <div className="grid gap-0.5"><span className="lbl">{label}</span>{v ? <b>{fmtTime(v)}</b> : dash}</div>
  );
  const dc = show.dayOfContact;
  const nameEl = show.venue
    ? <Link href={`/booking/venues/${show.venue.id}`} className="text-[17px] font-bold" style={{ color: "var(--ink)" }} data-testid="where-venue">{show.venue.name}</Link>
    : <span className="text-[17px] font-bold" data-testid="where-venue">{show.editionId && kindOf(show) !== "house" ? "Venue TBD" : showName(show)}</span>;

  const f = form;
  return (
    <EditableCard title="Where & when" testid="where-when" ed={ed} onSave={save} busy={busy} error={localError ?? cmdError}>
      {!ed.editing ? (
        <div className="grid gap-4">
          <div className="grid gap-1">
            {nameEl}
            {mapLabel && <a href={mapsUrl(mapQ)} target="_blank" rel="noopener noreferrer" data-testid="where-maps">{mapLabel} · Open in Google Maps ↗</a>}
          </div>
          {nothing ? (
            <UnfinishedPlaceholder testid="where-no-times" lead="No times yet."
              actions={admin ? <button type="button" className="btn ghost sm" onClick={ed.start} data-testid="where-add-times">Add times</button> : undefined}>
              Add load-in, soundcheck, doors and set time so everyone knows when to show up.
            </UnfinishedPlaceholder>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="where-times">
              {cell("Load in", t.loadIn)}{cell("Soundcheck", t.soundcheck)}{cell("Doors", t.doors)}
              {t.showStart ? cell("Show starts", t.showStart) : null}
              <div className="grid gap-0.5"><span className="lbl">Set</span>{setText ? <b>{setText}</b> : dash}{len ? <span className="s">{fmtDuration(len)}</span> : null}</div>
            </div>
          )}
          {dc ? (
            <div className="grid gap-0.5" data-testid="where-dayof"><span className="lbl">Day-of contact</span>
              <span>{dc.name}{dc.phone ? <> · <a href={`tel:${dc.phone.replace(/[^\d+]/g, "")}`}>{dc.phone}</a></> : null}</span></div>
          ) : (
            <UnfinishedPlaceholder row testid="where-no-contact" lead="No day-of contact." actions={admin ? <button type="button" className="btn ghost sm" onClick={() => { wantContact.current = true; ed.start(); }} data-testid="where-add-contact">Add contact</button> : undefined}>
              Who do we call when we get there?
            </UnfinishedPlaceholder>
          )}
          <div className="s flex flex-wrap items-center gap-x-5 gap-y-1" data-testid="where-foot">
            <CalendarSend kind="shows" id={show.id} eventId={show.calendarEventId} admin={admin} off={isOff(show)} testid="where-calendar" />
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
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
              <select className="select" value={f.venueId} onChange={(e) => set({ venueId: e.target.value, ...(f.dayOf.startsWith("c:") ? { dayOf: "" } : {}) })} data-testid="where-venue-select">
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

          <hr style={{ border: 0, borderTop: "1px solid var(--border)" }} />
          <div className="grid gap-2.5">
            {TIMES.map(([k, label]) => (
              <div key={k} className="grid items-center gap-x-3.5 gap-y-1 sm:grid-cols-[140px_minmax(0,220px)_auto]">
                <label htmlFor={`ww-${k}`} className="font-semibold">{label}</label>
                <input id={`ww-${k}`} className="input" type="time" value={f.times[k]} onChange={(e) => set({ times: { ...f.times, [k]: e.target.value } })} data-testid={`where-${k}`} />
                {k === "set" ? <button type="button" className="min-h-[44px] whitespace-nowrap text-left text-sm font-semibold" style={{ color: "var(--accent)" }}
                  onClick={() => set({ times: { ...f.times, set: f.times.showStart } })} data-testid="where-same-as-start">Same as show start</button> : <span />}
              </div>
            ))}
            <div className="grid items-center gap-x-3.5 gap-y-1 sm:grid-cols-[140px_minmax(0,220px)_auto]">
              <label htmlFor="ww-length" className="font-semibold">Set length</label>
              <input id="ww-length" className="input" value={f.setLength} placeholder="2h, 2:30, 90m" onChange={(e) => set({ setLength: e.target.value })}
                aria-invalid={lengthBad} aria-describedby="ww-length-says" data-testid="where-length" />
              <span id="ww-length-says" className={lengthBad ? "text-sm" : "s"} style={lengthBad ? { color: "var(--danger)" } : undefined} role={lengthBad ? "alert" : undefined} data-testid={lengthBad ? "where-length-error" : "where-length-says"}>
                {lengthBad ? "Couldn't read that. Try 2h, 2:30 or 90m." : sec ? `${describeDuration(sec)}${f.times.set ? ` · ends at ${endsAt(f.times.set, sec)}` : ""}` : ""}
              </span>
            </div>
          </div>

          <hr style={{ border: 0, borderTop: "1px solid var(--border)" }} />
          <label className="grid gap-1"><L>Day-of contact</L>
            <select className="select" value={f.dayOf} onChange={(e) => set({ dayOf: e.target.value })} data-testid="where-dayof-select">
              {contactGroups.filter(([, people]) => people.length > 0).map(([label, people]) => (
                <optgroup key={label} label={label}>
                  {people.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}{c.phones[0] ? ` · ${fmtPhone(c.phones[0])}` : ""}</option>)}
                </optgroup>
              ))}
              {show.dayOfContact && (f.dayOf === "keep" || (f.dayOf.startsWith("c:") && !venueContacts.some((c) => `c:${c.id}` === f.dayOf))) && (
                <option value={f.dayOf}>{show.dayOfContact.name}{show.dayOfContact.phone ? ` · ${show.dayOfContact.phone}` : ""}</option>
              )}
              <option value="">None</option>
              <option value="other">{atVenue ? "Create new…" : "Other…"}</option>
            </select>
            <span className="s">{atVenue ? "Pick someone from the venue, or create a new contact. Either way they're saved as the venue's day-of contact." : "Choose Other to type someone in."}</span>
          </label>
          {f.dayOf === "other" && (
            <div className="grid gap-3 rounded-xl p-3.5" style={{ background: "var(--bg)" }}>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <label className="grid gap-1"><L>Name</L><input className="input" value={f.otherName} onChange={(e) => set({ otherName: e.target.value })} data-testid="where-other-name" /></label>
                <label className="grid gap-1"><L>Phone</L><input className="input" type="tel" value={f.otherPhone} onChange={(e) => set({ otherPhone: e.target.value })} data-testid="where-other-phone" /></label>
              </div>
            </div>
          )}
        </div>
      )}
    </EditableCard>
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
