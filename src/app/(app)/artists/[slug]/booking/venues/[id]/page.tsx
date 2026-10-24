"use client";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { BackLink, ContactsPanel, EntityForm, FlagButton, PitchLinks, hrefFor, useBooking, useNotFound, venueForm } from "@/components/booking/common";
import { fmtDate } from "@/lib/booking";
import type { Show, Venue } from "@/schema";

export default function Page() { return <AdminOnly><VenuePage /></AdminOnly>; }

function VenuePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { doc: v, loading } = useDoc<Venue>("venues", id);
  const b = useBooking();
  const shows = useCollection<Show>("shows", { where: [["venue.id", "==", id]] });
  const { call, error } = useCommand();
  const [edit, setEdit] = useState(false);
  const nf = useNotFound(loading, v, "venue");
  if (nf || !v) return nf;
  const promoters = b.promoters.filter((p) => v.promoterIds.includes(p.id) || p.venueIds.includes(v.id));
  const pitches = b.pitches.filter((p) => p.target.kind === "venue" && p.target.id === id);
  const past = [...(shows.rows ?? [])].sort((a, c) => c.date.localeCompare(a.date));
  const facts = [v.address.city, v.capacity ? `${v.capacity} cap` : null, v.ages ? (v.ages === "all" ? "all ages" : `${v.ages}+`) : null,
    v.sound ? (v.sound.provider === "venueProvided" ? "venue sound" : "we bring sound") : null].filter(Boolean).join(" · ");
  return (
    <div className="grid gap-3" data-testid="venue-page">
      <BackLink href="/booking" label="Booking" />
      <PageTitle title={v.name} sub={facts} />
      <ErrorBox error={error} />
      <div className="flex flex-wrap gap-2">
        <FlagButton kind="venue" id={id} pitches={b.pitches} big />
        <button className="btn ghost" onClick={() => setEdit(!edit)} data-testid="edit-toggle">{edit ? "Done" : "Edit"}</button>
      </div>
      {edit && (
        <EntityForm testid="venue-edit" fields={venueForm.fields} initial={venueForm.initial(v)} build={venueForm.build}
          autosave={{ command: "venues.update", id, rev: v.rev, title: v.name }} />
      )}
      {!edit && (v.notes || v.loadInNotes || v.website) && (
        <div className="card">
          {v.website && <a className="font-semibold underline" href={v.website.startsWith("http") ? v.website : `https://${v.website}`} target="_blank" rel="noreferrer">{v.website}</a>}
          {v.loadInNotes && <span className="s">Load-in: {v.loadInNotes}</span>}
          {v.notes && <span className="s">{v.notes}</span>}
        </div>
      )}
      <ContactsPanel kind="venues" parentId={id} contactIds={v.contactIds} contacts={b.contacts} />
      {promoters.map((p) => <Link key={p.id} href={hrefFor("promoter", p.id)} className="note s" data-testid={`booked-by-${p.id}`}>Booked by <b>{p.name}</b></Link>)}
      <PromoterPicker venueId={id} current={v.promoterIds} all={b.promoters} call={call} />
      <span className="lbl">Pitches</span>
      <PitchLinks pitches={pitches} />
      <span className="lbl">Shows here</span>
      {past.length === 0 ? <span className="s" data-testid="no-shows">None yet</span> : (
        <div className="grid gap-2" data-testid="venue-shows">
          {past.map((s) => <div key={s.id} className="card"><b>{fmtDate(s.date)} {s.date.slice(0, 4)}</b><span className="s">{s.status}{s.editionName ? ` · ${s.editionName}` : ""}</span></div>)}
        </div>
      )}
      <button className="btn danger sm justify-self-start" onClick={async () => { if (confirm(`Archive ${v.name}?`) && (await call("venues.remove", { id }))) router.replace("/booking"); }}>Archive venue</button>
    </div>
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
