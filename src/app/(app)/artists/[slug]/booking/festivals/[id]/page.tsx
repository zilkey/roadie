"use client";
import { draftPath } from "@/schema/drafts";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useDoc } from "@/lib/firestore-hooks";
import { useHasDraft } from "@/lib/drafts";
import { BackLink, ContactsPanel, EntityForm, FlagButton, editionForm, festivalForm, hrefFor, useBooking, useNotFound } from "@/components/booking/common";
import { fmtDate } from "@/lib/booking";
import type { Festival } from "@/schema";

export default function Page() { return <AdminOnly><FestivalPage /></AdminOnly>; }

function FestivalPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { doc: f, loading } = useDoc<Festival>("festivals", id);
  const b = useBooking();
  const { call, error } = useCommand();
  const [edit, setEdit] = useState(false);
  const hasEdDraft = useHasDraft(draftPath.newUnder("festivals", id, "editions"));
  const [addEdX, setAddEd] = useState<boolean | null>(null);
  const addEd = addEdX ?? hasEdDraft; // an unfinished year opens the form
  const nf = useNotFound(loading, f, "festival");
  if (nf || !f) return nf;
  const editions = b.editions.filter((e) => e.festivalId === id).sort((a, c) => c.year - a.year);
  return (
    <div className="grid gap-3" data-testid="festival-page">
      <BackLink href="/booking" label="Booking" />
      <PageTitle title={f.name} sub={[f.type === "series" ? "Series" : "Festival", f.genres, f.typicalMonth ? `usually ${new Date(2000, f.typicalMonth - 1).toLocaleString("en-US", { month: "long" })}` : null].filter(Boolean).join(" · ")} />
      <ErrorBox error={error} />
      <div className="flex flex-wrap gap-2">
        <button className="btn ghost" onClick={() => setEdit(!edit)} data-testid="edit-toggle">{edit ? "Done" : "Edit"}</button>
      </div>
      {edit && (
        <EntityForm testid="festival-edit" fields={festivalForm.fields} initial={festivalForm.initial(f)} build={festivalForm.build}
          autosave={{ command: "festivals.update", id, rev: f.rev, title: f.name }} />
      )}
      {!edit && (f.website || f.notes) && <div className="card">{f.website && <a className="underline" href={f.website} target="_blank" rel="noreferrer">{f.website}</a>}{f.notes && <span className="s">{f.notes}</span>}</div>}
      <span className="lbl">Years</span>
      {editions.length === 0 && <span className="s">No dates yet.</span>}
      {editions.map((e) => (
        <div key={e.id} className="card" style={{ display: "flex" }} data-testid={`edition-${e.id}`}>
          <Link href={hrefFor("edition", e.id)} className="grid flex-1 gap-0.5">
            <b>{e.label}</b>
            <span className="s">{[e.startDate && `${fmtDate(e.startDate)}${e.endDate ? `–${fmtDate(e.endDate)}` : ""}`, e.appOpens && `opens ${fmtDate(e.appOpens.date)}`, e.appDeadline && `closes ${fmtDate(e.appDeadline.date)} (${e.appDeadline.sure})`].filter(Boolean).join(" · ")}</span>
          </Link>
          <FlagButton kind="edition" id={e.id} pitches={b.pitches} />
        </div>
      ))}
      <button className="btn ghost sm justify-self-start" onClick={() => setAddEd(!addEd)} data-testid="add-edition">{addEd ? "Close" : "+ Add a year"}</button>
      {addEd && (
        <EntityForm testid="new-edition" fields={editionForm.fields} initial={editionForm.blank} build={editionForm.build} submitLabel="Add year"
          draft={{ path: draftPath.newUnder("festivals", id, "editions"), title: (v) => `New year · ${f.name} ${v.label ?? ""}`.trim() }}
          onSubmit={async (d, meta) => { const r = await call("editions.create", { ...d, festivalId: id }, meta); if (r) setAddEd(false); return !!r; }} />
      )}
      <ContactsPanel kind="festivals" parentId={id} contactIds={f.contactIds} contacts={b.contacts} />
      <button className="btn danger sm justify-self-start" onClick={async () => { if (confirm(`Archive ${f.name} and its years?`) && (await call("festivals.remove", { id }))) router.replace("/booking"); }}>Archive festival</button>
    </div>
  );
}
