"use client";
/**
 * Where & when's day-of contact. The value (or the "No day-of contact" box's Add contact) opens a small popover: the venue's
 * day-of contacts, its other people, "Someone else…" (at a venue they become one of its contacts, ticked day-of) and None.
 * Positioned and dismissed like the StatusPill menu: absolute under the trigger, Escape and an outside click close it.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useArtist } from "@/lib/artist";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { ErrorBox, useCommand } from "@/components/ui";
import { kindOf } from "@/lib/shows";
import type { Contact, Venue, VenueNote } from "@/schema";
import { dayOfContactOf, fmtPhone, privateOf, roleFirst } from "@/lib/venues";
import type { ShowRow } from "../common";
import { UnfinishedPlaceholder } from "./kit";

/** A typed phone number as E.164 for a contact, or null when it can't be one. */
function toE164(p: string): string | null {
  const d = p.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === "1") return `+${d}`;
  return null;
}
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;
const PenIcon = () => (
  <svg className="pen" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

/** "c:<contactId>" a venue contact, "keep" the typed-in person already on the show, "other" someone new, "none" clear it. */
type Pick = string;

export function DayOfContact({ show, admin }: { show: ShowRow; admin: boolean }) {
  const { artistId } = useArtist();
  const { call, error, busy, setError } = useCommand();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<Pick>("none");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  // Admin-only reads (rules): the band's venue notes and contacts. The shared venue doc only for older records that kept them there.
  const venueId = show.venue?.id ?? "";
  const notes = useCollection<VenueNote>("venueNotes", { where: [["artistId", "==", artistId]], skip: !admin });
  const contacts = useCollection<Contact>("contacts", { skip: !admin });
  const venues = useCollection<Venue>("venues", { skip: !admin || !open || !venueId });
  const venue = (venues.rows ?? []).find((v) => v.id === venueId);
  const vn = privateOf((notes.rows ?? []).find((x) => x.venueId === venueId) ?? venue);
  const people = roleFirst(vn.contactIds.map((id) => (contacts.rows ?? []).find((c) => c.id === id)).filter((c): c is Row<Contact> => !!c), vn.dayOfContactIds);
  const dayOfPeople = people.filter((c) => vn.dayOfContactIds.includes(c.id));
  const others = people.filter((c) => !dayOfPeople.includes(c));
  const venueName = show.venue?.name ?? "the venue";
  // At a venue a typed-in person becomes one of its contacts; a private event or a festival with the venue TBD just keeps the name.
  const atVenue = kindOf(show) !== "house" && !!venueId;

  const dc = show.dayOfContact;
  const current: Pick = dc ? (dc.contactId && people.some((c) => c.id === dc.contactId) ? `c:${dc.contactId}` : "keep") : "none";

  function close() { setOpen(false); setError(null); setLocalError(null); trigger.current?.focus(); }
  function toggle() {
    if (open) return close();
    setPick(dc ? current : people[0] ? `c:${people[0].id}` : "other");
    setName(""); setPhone(""); setLocalError(null); setError(null);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) { setOpen(false); setError(null); setLocalError(null); } };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setLocalError(null);
    let dayOfContact: Record<string, string> | null;
    if (pick === "none") dayOfContact = null;
    else if (pick.startsWith("c:")) {
      const c = people.find((x) => `c:${x.id}` === pick);
      if (!c) return;
      dayOfContact = dayOfContactOf(c);
    } else if (pick === "other") {
      const n = name.trim();
      if (!n) { setLocalError("Add the contact's name."); return; }
      const p = phone.trim();
      let contactId: string | undefined;
      if (atVenue) {
        const e164 = p ? toE164(p) : null;
        if (p && !e164) { setLocalError("That phone number doesn't look right. Use 10 digits, like (303) 555-0142."); return; }
        const r = await call<{ id: string }>("contacts.create", { name: n, phones: e164 ? [e164] : [], emails: [], attachTo: { kind: "venues", id: venueId } });
        if (!r?.id) return;
        contactId = r.id;
      }
      // shows.update ticks them as a day-of contact at the venue.
      dayOfContact = { name: n, ...(p ? { phone: p } : {}), ...(contactId ? { contactId } : {}) };
    } else return close();
    const r = await call("shows.update", { id: show.id, patch: { dayOfContact } });
    if (r !== undefined) { setOpen(false); trigger.current?.focus(); }
  }

  const pickedPerson = pick.startsWith("c:") ? people.find((c) => `c:${c.id}` === pick) : undefined;
  const saveLabel = pick === "none" ? "Clear contact" : pick === "other" ? "Add and use"
    : `Use ${firstName(pickedPerson?.name ?? dc?.name ?? "")}`;
  const unchanged = pick === current && pick !== "other";

  const shown = dc ? <>{dc.name}{dc.phone ? <> · {dc.phone}</> : null}</> : null;

  if (!admin) {
    return dc ? (
      <div className="grid gap-0.5" data-testid="where-dayof-row"><span className="lbl">Day-of contact</span>
        <span data-testid="where-dayof">{dc.name}{dc.phone ? <> · <a href={`tel:${dc.phone.replace(/[^\d+]/g, "")}`}>{dc.phone}</a></> : null}</span></div>
    ) : (
      <UnfinishedPlaceholder row testid="where-no-contact" lead="No day-of contact.">Who do we call when we get there?</UnfinishedPlaceholder>
    );
  }

  const option = (value: Pick, body: React.ReactNode, testid: string, pill?: string) => (
    <label key={value} className="flex cursor-pointer items-center gap-3 rounded-[10px] px-3.5" style={{ minHeight: 48, background: pick === value ? "var(--divider)" : undefined }}>
      <input type="radio" name={`${dialogId}-dayof`} value={value} checked={pick === value} onChange={() => setPick(value)} data-testid={testid} style={{ width: 18, height: 18, accentColor: "var(--accent)", margin: 0 }} />
      {body}
      {pill && <span className="chip a" style={{ marginLeft: "auto" }}>{pill}</span>}
    </label>
  );
  const personRow = (c: Row<Contact>) => option(`c:${c.id}`, (
    <span className="grid gap-px"><b>{c.name}</b>
      {(c.phones[0] || c.emails[0]) && <span className="s">{[c.phones[0] ? fmtPhone(c.phones[0]) : "", c.emails[0] ?? ""].filter(Boolean).join(" · ")}</span>}</span>
  ), `dayof-opt-${c.id}`, vn.dayOfContactIds.includes(c.id) ? "Day-of" : vn.bookingContactIds.includes(c.id) ? "Booking" : undefined);
  const grp = (text: string) => <span className="lbl" style={{ padding: "10px 14px 4px" }}>{text}</span>;

  const popover = open && (
    <div id={dialogId} role="dialog" aria-label="Day-of contact" data-testid="dayof-menu" className="card"
      style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 30, width: "min(520px, calc(100vw - 32px))", padding: 14, gap: 4, boxShadow: "0 12px 32px rgba(40,30,10,.16)" }}>
      <div role="radiogroup" aria-label="Day-of contact" className="grid gap-1">
        {dayOfPeople.length > 0 && <>{grp(`Day-of contacts at ${venueName}`)}{dayOfPeople.map(personRow)}</>}
        {others.length > 0 && <>{grp(`${dayOfPeople.length ? "Other " : ""}${venueName} contacts`)}{others.map(personRow)}</>}
        {dc && current === "keep" && option("keep", <span className="grid gap-px"><b>{dc.name}</b>{dc.phone && <span className="s">{dc.phone}</span>}</span>, "dayof-opt-keep")}
        {people.length > 0 && <span aria-hidden style={{ height: 6 }} />}
        {option("other", <b>Someone else…</b>, "dayof-opt-other")}
        {pick === "other" && (
          <div className="grid gap-2.5 sm:grid-cols-2" style={{ padding: "6px 14px 10px" }}>
            <label className="grid gap-1.5"><span className="lbl">Name</span>
              <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} data-testid="dayof-other-name" /></label>
            <label className="grid gap-1.5"><span className="lbl">Phone</span>
              <input className="input" type="tel" placeholder="(303) 555-0142" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="dayof-other-phone" /></label>
            {atVenue && <span className="s sm:col-span-2">They&rsquo;re added to {venueName}&rsquo;s contacts as a day-of contact.</span>}
          </div>
        )}
        {option("none", <span className="s">None</span>, "dayof-opt-none")}
      </div>
      <div style={{ padding: "0 14px" }}><ErrorBox error={localError ?? error} /></div>
      <div className="flex justify-end gap-2.5" style={{ padding: "10px 14px 4px" }}>
        <button type="button" className="btn outline" onClick={close} data-testid="dayof-cancel">Cancel</button>
        <button type="button" className="btn acc" disabled={busy || unchanged} onClick={() => void save()} data-testid="dayof-save">{saveLabel}</button>
      </div>
    </div>
  );

  return (
    <div className="relative" ref={root}>
      {dc ? (
        <div className="grid gap-0.5" data-testid="where-dayof-row"><span className="lbl">Day-of contact</span>
          <button ref={trigger} type="button" className="val self-start" aria-label={`Change the day-of contact, currently ${dc.name}`}
            aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? dialogId : undefined} onClick={toggle} data-testid="where-dayof">
            <span className="min-w-0">{shown}</span><PenIcon />
          </button>
        </div>
      ) : (
        <UnfinishedPlaceholder row testid="where-no-contact" lead="No day-of contact."
          actions={<button ref={trigger} type="button" className="btn ghost sm" aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? dialogId : undefined} onClick={toggle} data-testid="where-add-contact">Add contact</button>}>
          Who do we call when we get there?
        </UnfinishedPlaceholder>
      )}
      {popover}
    </div>
  );
}
