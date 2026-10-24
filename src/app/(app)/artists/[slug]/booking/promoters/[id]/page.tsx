"use client";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useDoc } from "@/lib/firestore-hooks";
import { BackLink, ContactsPanel, EntityForm, Flagged, PitchLinks, hrefFor, promoterForm, useBooking, useNotFound } from "@/components/booking/common";
import type { Promoter } from "@/schema";

export default function Page() { return <AdminOnly><PromoterPage /></AdminOnly>; }

function PromoterPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { doc: p, loading } = useDoc<Promoter>("promoters", id);
  const b = useBooking();
  const { call, error } = useCommand();
  const [edit, setEdit] = useState(false);
  const nf = useNotFound(loading, p, "promoter");
  if (nf || !p) return nf;
  const venues = b.venues.filter((v) => p.venueIds.includes(v.id) || v.promoterIds.includes(p.id));
  return (
    <div className="grid gap-3" data-testid="promoter-page">
      <BackLink href="/booking" label="Booking" />
      <PageTitle title={p.name} sub={`${p.kind === "venueGroup" ? "Venue group" : p.kind[0].toUpperCase() + p.kind.slice(1)}${venues.length ? ` · ${venues.length} venues` : ""}`} />
      <ErrorBox error={error} />
      <Flagged kind="promoter" id={id} pitches={b.pitches} big>{(flag, flagForm) => (<>
        <div className="flex flex-wrap items-start gap-2">
          {flag}
          <button className="btn ghost" onClick={() => setEdit(!edit)} data-testid="edit-toggle">{edit ? "Done" : "Edit"}</button>
        </div>
        {flagForm}
      </>)}</Flagged>
      {edit && (
        <EntityForm testid="promoter-edit" fields={promoterForm.fields} initial={promoterForm.initial(p)} build={promoterForm.build}
          autosave={{ command: "promoters.update", id, rev: p.rev, title: p.name }} />
      )}
      {!edit && (p.howToPitch || p.notes || p.website) && (
        <div className="card">
          {p.howToPitch && <span><span className="lbl">How to pitch</span><br />{p.howToPitch}</span>}
          {p.website && <a className="underline" href={p.website} target="_blank" rel="noreferrer">{p.website}</a>}
          {p.notes && <span className="s">{p.notes}</span>}
        </div>
      )}
      <ContactsPanel kind="promoters" parentId={id} contactIds={p.contactIds} contacts={b.contacts} />
      <span className="lbl">Venues</span>
      {venues.length === 0 ? <span className="s">None linked.</span> : venues.map((v) => (
        <Link key={v.id} href={hrefFor("venue", v.id)} className="card"><b>{v.name}</b><span className="s">{v.address.city}</span></Link>
      ))}
      <span className="lbl">Pitches</span>
      <PitchLinks pitches={b.pitches.filter((x) => x.target.kind === "promoter" && x.target.id === id)} />
      <button className="btn danger sm justify-self-start" onClick={async () => { if (confirm(`Archive ${p.name}?`) && (await call("promoters.remove", { id }))) router.replace("/booking"); }}>Archive promoter</button>
    </div>
  );
}
