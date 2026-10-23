"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useDoc } from "@/lib/firestore-hooks";
import { BackLink, EntityForm, FlagButton, PitchLinks, editionForm, hrefFor, useBooking, useNotFound } from "@/components/booking/common";
import { fmtDate } from "@/lib/booking";
import { ShowLinks } from "@/components/shows/common";
import type { Edition } from "@/schema";

export default function Page() { return <AdminOnly><EditionPage /></AdminOnly>; }

function EditionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { doc: e, loading } = useDoc<Edition>("editions", id);
  const b = useBooking();
  const { call, error } = useCommand();
  const [edit, setEdit] = useState(false);
  const nf = useNotFound(loading, e, "year");
  if (nf || !e) return nf;
  const sure = (s: string) => (s === "confirmed" ? "" : ` (${s})`);
  return (
    <div className="grid gap-3" data-testid="edition-page">
      <BackLink href={hrefFor("festival", e.festivalId)} label={e.festivalName} />
      <PageTitle title={`${e.festivalName} ${e.label}`} sub={e.startDate ? `${fmtDate(e.startDate)}${e.endDate ? `–${fmtDate(e.endDate)}` : ""}` : "Dates not set"} />
      <ErrorBox error={error} />
      <div className="flex flex-wrap gap-2">
        <FlagButton kind="edition" id={id} pitches={b.pitches} big />
        <button className="btn ghost" onClick={() => setEdit(!edit)} data-testid="edit-toggle">{edit ? "Done" : "Edit"}</button>
      </div>
      {edit ? (
        <EntityForm testid="edition-edit" fields={editionForm.fields} initial={editionForm.initial(e)} build={editionForm.build}
          autosave={{ command: "editions.update", id, rev: e.rev, title: `${e.festivalName} ${e.label}` }} />
      ) : (
        <div className="card" data-testid="edition-facts">
          {e.appOpens && <span>Applications open <b>{fmtDate(e.appOpens.date)}</b>{sure(e.appOpens.sure)}</span>}
          {e.appDeadline && <span>Deadline <b>{fmtDate(e.appDeadline.date)}</b>{sure(e.appDeadline.sure)}</span>}
          {e.notifyDate && <span>Decision by <b>{fmtDate(e.notifyDate)}</b></span>}
          {e.applyUrl && <a className="font-semibold underline" href={e.applyUrl} target="_blank" rel="noreferrer">Apply link</a>}
          {e.payNotes && <span className="s">Pay: {e.payNotes}</span>}
          {e.notes && <span className="s">{e.notes}</span>}
          {!e.appOpens && !e.appDeadline && !e.applyUrl && <span className="s">No application dates yet.</span>}
        </div>
      )}
      <span className="lbl">Our shows</span>
      <ShowLinks where={["editionId", "==", id]} empty="None yet." testid="edition-shows" />
      <span className="lbl">Pitches</span>
      <PitchLinks pitches={b.pitches.filter((p) => p.target.kind === "edition" && p.target.id === id)} />
      <Link href={hrefFor("festival", e.festivalId)} className="btn ghost sm justify-self-start">All years of {e.festivalName}</Link>
      <button className="btn ghost sm justify-self-start" onClick={async () => { if (confirm("Archive this year?") && (await call("editions.remove", { id }))) router.replace(hrefFor("festival", e.festivalId)); }}>Archive this year</button>
    </div>
  );
}
