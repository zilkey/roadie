"use client";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Dialog, ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import {
  BackLink, ContactsPanel, EntityForm, Flagged, FormFields, PitchLinks, changedKeys, hrefFor, roomForm, useBooking, useNotFound, venueNotesForm, type Field, type Values, type VenueRow,
} from "@/components/booking/common";
import { fmtDate } from "@/lib/booking";
import { privateOf } from "@/lib/venues";
import type { Show, Venue } from "@/schema";

/**
 * A venue is two documents. "About the room" is the shared record every band user can read and fix (an explicit Save, behind a
 * confirmation that says it changes the room for every band). "Our notes" is this band's private notes, contacts and promoters:
 * admins only, and they autosave.
 */
export default function VenuePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { role } = useArtist();
  const admin = role === "admin";
  const { doc: v, loading } = useDoc<Venue>("venues", id, { includeDeleted: true });
  const b = useBooking();
  const shows = useCollection<Show>("shows", { where: [["venue.id", "==", id]] });
  const { call, error } = useCommand();
  const mergedInto = v?.deletedAt ? v.mergedInto : undefined;
  useEffect(() => { if (mergedInto) router.replace(hrefFor("venue", mergedInto)); }, [mergedInto, router]);
  const nf = useNotFound(loading, v && !v.deletedAt ? v : null, "venue");
  if (mergedInto) return <div className="card" data-testid="merged-redirect">This venue was merged into another one. Taking you there…</div>;
  if (nf || !v) return nf;

  const note = b.venueNotes.get(id);
  const mine = privateOf(note ?? v);
  const archived = !!note?.deletedAt;
  const promoters = b.promoters.filter((p) => mine.promoterIds.includes(p.id) || p.venueIds.includes(v.id));
  const pitches = b.pitches.filter((p) => p.target.kind === "venue" && p.target.id === id);
  const past = [...(shows.rows ?? [])].sort((a, c) => c.date.localeCompare(a.date));
  const facts = [v.address.city, v.capacity ? `${v.capacity} cap` : null, v.ages ? (v.ages === "all" ? "all ages" : `${v.ages}+`) : null,
    v.sound ? (v.sound.provider === "venueProvided" ? "venue sound" : "we bring sound") : null].filter(Boolean).join(" · ");
  return (
    <div className="grid gap-3" data-testid="venue-page">
      <BackLink href={admin ? "/booking" : "/shows"} label={admin ? "Booking" : "Shows"} />
      <PageTitle title={v.name} sub={facts} />
      <ErrorBox error={error} />
      {archived && (
        <div className="card hi" data-testid="venue-archived">
          <span>You archived this venue for your band. Other bands still see it.</span>
          <div><button className="btn ghost sm" data-testid="venue-unarchive"
            onClick={() => call("venues.create", { name: v.name, type: v.type, address: v.address, region: v.region })}>Bring it back to our lists</button></div>
        </div>
      )}
      {admin && (
        <Flagged kind="venue" id={id} pitches={b.pitches} big>{(flag, flagForm) => (<>
          <div className="flex flex-wrap items-start gap-2">{flag}</div>
          {flagForm}
        </>)}</Flagged>
      )}

      <RoomCard v={v} />

      {admin && (
        <>
          <span className="lbl">Our notes</span>
          <div className="s" data-testid="notes-private">Only your band&apos;s admins see these.</div>
          <EntityForm testid="notes" fields={venueNotesForm.fields} initial={venueNotesForm.initial(mine)} build={venueNotesForm.build}
            autosave={{ command: "venues.update", id, rev: note?.rev, title: `${v.name} notes` }} />
          <ContactsPanel kind="venues" parentId={id} contactIds={mine.contactIds} contacts={b.contacts} />
          {promoters.map((p) => <Link key={p.id} href={hrefFor("promoter", p.id)} className="note s" data-testid={`booked-by-${p.id}`}>Booked by <b>{p.name}</b></Link>)}
          <PromoterPicker venueId={id} current={mine.promoterIds} all={b.promoters} call={call} />
          <span className="lbl">Pitches</span>
          <PitchLinks pitches={pitches} />
        </>
      )}
      <span className="lbl">Shows here</span>
      {past.length === 0 ? <span className="s" data-testid="no-shows">None yet</span> : (
        <div className="grid gap-2" data-testid="venue-shows">
          {past.map((s) => (
            <Link key={s.id} href={`/shows/${s.id}`} className="card" data-testid={`venue-show-${s.id}`}><b>{fmtDate(s.date)} {s.date.slice(0, 4)}</b><span className="s">{s.status}{s.editionName ? ` · ${s.editionName}` : ""}</span></Link>
          ))}
        </div>
      )}
      {admin && (
        <div className="flex flex-wrap gap-2">
          <MergePanel v={v} venues={b.venues} onDone={(into) => router.replace(hrefFor("venue", into))} />
          {!archived && (
            <button className="btn danger sm" data-testid="venue-archive"
              onClick={async () => { if (confirm(`Archive ${v.name} for your band? It leaves your lists; other bands keep it.`) && (await call("venues.remove", { id }))) router.replace("/booking"); }}>Archive venue</button>
          )}
        </div>
      )}
    </div>
  );
}

const shown = (f: Field, vals: Values) => {
  const x = vals[f.key] ?? "";
  return (f.type === "select" ? f.options?.find(([val]) => val === x)?.[1] ?? x : x) || "—";
};

/** The shared room: facts, and an Edit that ends in an explicit Save and a "this changes it for every band" confirmation. */
function RoomCard({ v }: { v: Venue & { id: string } }) {
  const initial = useMemo(() => roomForm.initial(v), [v]);
  const [edit, setEdit] = useState(false);
  const [vals, setVals] = useState<Values>(initial);
  const [confirming, setConfirming] = useState(false);
  const { call, error, busy, setError } = useCommand();
  const changes = roomForm.fields.filter((f) => (initial[f.key] ?? "") !== (vals[f.key] ?? ""));

  function open() { setVals(initial); setError(null); setEdit(true); }
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!changes.length) return setEdit(false);
    setConfirming(true);
  }
  async function confirm() {
    const patch = changedKeys(roomForm.build, initial, vals);
    if (await call("venues.update", { id: v.id, patch }, { baseRev: v.rev })) { setConfirming(false); setEdit(false); }
  }

  const street = [v.address.street, v.address.city, [v.address.state, v.address.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const rows: [string, React.ReactNode][] = [
    ["Address", street], ["Type", roomForm.fields[1].options!.find(([k]) => k === v.type)?.[1] ?? v.type],
    ["Capacity", v.capacity ?? ""], ["Ages", v.ages ? (v.ages === "all" ? "All ages" : `${v.ages}+`) : ""],
    ["Sound", v.sound ? `${v.sound.provider === "venueProvided" ? "Venue provides" : "Band brings"}${v.sound.notes ? ` · ${v.sound.notes}` : ""}` : ""],
    ["Website", v.website ? <a className="underline" href={v.website.startsWith("http") ? v.website : `https://${v.website}`} target="_blank" rel="noreferrer">{v.website}</a> : ""],
    ["Instagram", v.instagram ? `@${v.instagram}` : ""],
  ];
  return (
    <>
      {edit ? (
        <form className="card" onSubmit={save} data-testid="room-form">
          <span className="lbl">About the room</span>
          <span className="s">Shared with every band that uses Band Tracker.</span>
          <FormFields fields={roomForm.fields} v={vals} set={(k, val) => setVals({ ...vals, [k]: val })} testid="room" />
          <div className="flex gap-2">
            <button className="btn acc" type="submit" data-testid="room-save">Save</button>
            <button className="btn ghost" type="button" data-testid="room-cancel" onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="card" data-testid="room-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="lbl">About the room</span>
            <button className="btn ghost sm" onClick={open} data-testid="room-edit">Edit</button>
          </div>
          <span className="s">Shared with every band that uses Band Tracker.</span>
          <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
            {rows.filter(([, x]) => x !== "").map(([k, x]) => (<div key={k} className="contents"><dt className="s">{k}</dt><dd data-testid={`room-${k.toLowerCase()}`}>{x}</dd></div>))}
          </dl>
        </div>
      )}
      <Dialog open={confirming} onClose={() => setConfirming(false)} title={`Update ${v.name} for every band?`} testid="room-confirm-dialog">
        <p className="s">This updates {v.name} for every band that uses Band Tracker. Your name is recorded in its history.</p>
        <ul className="grid gap-1" data-testid="room-changes">
          {changes.map((f) => (
            <li key={f.key} data-testid={`room-change-${f.key}`}><b>{f.label}</b>: <span className="text-muted line-through">{shown(f, initial)}</span> → <span>{shown(f, vals)}</span></li>
          ))}
        </ul>
        <ErrorBox error={error} />
        <div className="flex flex-wrap gap-2">
          <button className="btn acc" disabled={busy} data-testid="room-confirm" onClick={confirm}>Save for everyone</button>
          <button className="btn ghost" data-testid="room-confirm-cancel" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      </Dialog>
    </>
  );
}

/** "Merge into another venue…": pick the room to keep, confirm, and every band's shows, pitches and notes move to it. */
function MergePanel({ v, venues, onDone }: { v: Venue & { id: string }; venues: VenueRow[]; onDone(into: string): void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [into, setInto] = useState<VenueRow | null>(null);
  const { call, error, busy, setError } = useCommand();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = venues.filter((x) => x.id !== v.id && words.every((w) => `${x.name} ${x.address.city}`.toLowerCase().includes(w))).slice(0, 8);
  function close() { setOpen(false); setQ(""); setInto(null); setError(null); }
  async function merge() {
    if (!into) return;
    const r = await call("venues.mergeInto", { from: v.id, into: into.id });
    if (r) { close(); onDone(into.id); }
  }
  return (
    <>
      <button className="btn ghost sm" onClick={() => setOpen(true)} data-testid="merge-open">Merge into another venue…</button>
      <Dialog open={open} onClose={close} title={into ? "Merge these two venues?" : `Merge ${v.name} into…`} testid="merge-dialog">
        {!into ? (
          <>
            <input className="input" placeholder="Search venues by name or city" value={q} onChange={(e) => setQ(e.target.value)} data-testid="merge-search" autoFocus />
            <div className="grid gap-1" data-testid="merge-results">
              {q.trim() && hits.length === 0 && <span className="s">No venue matches.</span>}
              {hits.map((x) => (
                <button key={x.id} type="button" className="card text-left" onClick={() => setInto(x)} data-testid={`merge-pick-${x.id}`}><b>{x.name}</b><span className="s">{x.address.city}, {x.address.state}</span></button>
              ))}
            </div>
            <div><button className="btn ghost" onClick={close} data-testid="merge-cancel">Cancel</button></div>
          </>
        ) : (
          <>
            <p data-testid="merge-summary">Merge <b>{v.name}</b> ({v.address.city}) into <b>{into.name}</b> ({into.address.city})? Every band&apos;s shows, pitches and notes at {v.name} will move to {into.name}, and {v.name} will be archived. You can undo it from History.</p>
            <ErrorBox error={error} />
            <div className="flex flex-wrap gap-2">
              <button className="btn acc" disabled={busy} onClick={merge} data-testid="merge-confirm">Merge</button>
              <button className="btn ghost" onClick={() => { setInto(null); setError(null); }} data-testid="merge-back">Back</button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}

function PromoterPicker({ venueId, current, all, call }: { venueId: string; current: string[]; all: { id: string; name: string; venueIds: string[] }[]; call: (n: string, i: unknown) => Promise<unknown> }) {
  const linked = new Set([...current, ...all.filter((p) => p.venueIds.includes(venueId)).map((p) => p.id)]);
  const options = all.filter((p) => !linked.has(p.id));
  if (!options.length) return null;
  return (
    <select className="select" value="" data-testid="promoter-link" onChange={(e) => e.target.value && call("venues.update", { id: venueId, patch: { promoterIds: [...linked, e.target.value] } })}>
      <option value="">Booked by a promoter…</option>
      {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}
