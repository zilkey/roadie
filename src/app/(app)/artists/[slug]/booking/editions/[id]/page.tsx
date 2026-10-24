"use client";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { useDoc } from "@/lib/firestore-hooks";
import { BackLink, EntityForm, Flagged, PitchLinks, editionForm, hrefFor, useBooking, useNotFound } from "@/components/booking/common";
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
  const archive = async () => { if (confirm("Archive this year?") && (await call("editions.remove", { id }))) router.replace(hrefFor("festival", e.festivalId)); };
  return (
    <div className="grid gap-5" data-testid="edition-page">
      <PageTitle back={<BackLink href={hrefFor("festival", e.festivalId)} label={e.festivalName} />} title={`${e.festivalName} ${e.label}`}
        sub={e.startDate ? `${fmtDate(e.startDate)}${e.endDate ? `–${fmtDate(e.endDate)}` : ""}` : "Dates not set"}
        actions={<>
          <button className="btn ghost" onClick={() => setEdit(!edit)} data-testid="edit-toggle">{edit ? "Done" : "Edit"}</button>
          <Menu label="More actions" testid="edition" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={[{ key: "archive", label: "Archive this year", danger: true, onSelect: archive }]} />
        </>} />
      <ErrorBox error={error} />
      <div className="cols">
        <div className="col-main">
          <Flagged kind="edition" id={id} pitches={b.pitches} big>{(flag, flagForm) => (<>
            <div className="flex flex-wrap items-start gap-2">{flag}</div>
            {flagForm}
          </>)}</Flagged>
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
          <div className="grid gap-3">
            <span className="lbl">Our shows</span>
            <ShowLinks where={["editionId", "==", id]} empty="None yet." testid="edition-shows" />
          </div>
        </div>
        <div className="col-side">
          <div className="grid gap-3">
            <span className="lbl">Pitches</span>
            <PitchLinks pitches={b.pitches.filter((p) => p.target.kind === "edition" && p.target.id === id)} />
          </div>
          <Link href={hrefFor("festival", e.festivalId)} className="btn ghost sm justify-self-start">All years of {e.festivalName}</Link>
        </div>
      </div>
    </div>
  );
}
