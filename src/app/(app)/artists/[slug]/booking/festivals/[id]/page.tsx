"use client";
import { draftPath } from "@/schema/drafts";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { useDoc } from "@/lib/firestore-hooks";
import { useHasDraft } from "@/lib/drafts";
import { BackLink, ContactsPanel, EntityForm, Flagged, editionForm, festivalForm, hrefFor, useBooking, useNotFound } from "@/components/booking/common";
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
  const [askedEd] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("addEdition") === "1");
  const addEd = addEdX ?? (askedEd || hasEdDraft); // an unfinished year, or ?addEdition=1 (the Festivals tab's "Add edition"), opens the form
  const nf = useNotFound(loading, f, "festival");
  if (nf || !f) return nf;
  const editions = b.editions.filter((e) => e.festivalId === id).sort((a, c) => c.year - a.year);
  const archive = async () => { if (confirm(`Archive ${f.name} and its years?`) && (await call("festivals.remove", { id }))) router.replace("/booking"); };
  return (
    <div className="grid gap-5" data-testid="festival-page">
      <PageTitle back={<BackLink href="/booking/festivals" label="All festivals" />} title={f.name}
        sub={[f.type === "series" ? "Series" : "Festival", f.genres, f.typicalMonth ? `usually ${new Date(2000, f.typicalMonth - 1).toLocaleString("en-US", { month: "long" })}` : null].filter(Boolean).join(" · ")}
        actions={<>
          <button className="btn ghost" onClick={() => setEdit(!edit)} data-testid="edit-toggle">{edit ? "Done" : "Edit"}</button>
          <Menu label="More actions" testid="festival" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={[{ key: "archive", label: "Archive festival", danger: true, onSelect: archive }]} />
        </>} />
      <ErrorBox error={error} />
      <div className="cols">
        <div className="col-main">
          {edit && (
            <EntityForm testid="festival-edit" fields={festivalForm.fields} initial={festivalForm.initial(f)} build={festivalForm.build}
              autosave={{ command: "festivals.update", id, rev: f.rev, title: f.name }} />
          )}
          {!edit && (f.website || f.notes) && <div className="card">{f.website && <a className="underline" href={f.website} target="_blank" rel="noreferrer">{f.website}</a>}{f.notes && <span className="s">{f.notes}</span>}</div>}
          <div className="grid gap-3">
            <span className="lbl">Years</span>
            {editions.length === 0 && <div className="empty"><span>No dates yet.</span></div>}
            {editions.map((e) => (
              <div key={e.id} className="card" data-testid={`edition-${e.id}`}>
                <Flagged kind="edition" id={e.id} pitches={b.pitches}>{(flag, flagForm) => (<>
                  <div className="flex items-center gap-2">
                    <Link href={hrefFor("edition", e.id)} className="grid flex-1 gap-0.5">
                      <b>{e.label}</b>
                      <span className="s">{[e.startDate && `${fmtDate(e.startDate)}${e.endDate ? `–${fmtDate(e.endDate)}` : ""}`, e.appOpens && `opens ${fmtDate(e.appOpens.date)}`, e.appDeadline && `closes ${fmtDate(e.appDeadline.date)} (${e.appDeadline.sure})`].filter(Boolean).join(" · ")}</span>
                    </Link>
                    {flag}
                  </div>
                  {flagForm}
                </>)}</Flagged>
              </div>
            ))}
            <button className="btn ghost sm justify-self-start" onClick={() => setAddEd(!addEd)} data-testid="add-edition">{addEd ? "Close" : "+ Add a year"}</button>
            {addEd && (
              <EntityForm testid="new-edition" fields={editionForm.fields} initial={editionForm.blank} build={editionForm.build} submitLabel="Add year"
                draft={{ path: draftPath.newUnder("festivals", id, "editions"), title: (v) => `New year · ${f.name} ${v.label ?? ""}`.trim() }}
                onSubmit={async (d, meta) => { const r = await call("editions.create", { ...d, festivalId: id }, meta); if (r) setAddEd(false); return !!r; }} />
            )}
          </div>
        </div>
        <div className="col-side">
          <ContactsPanel kind="festivals" parentId={id} contactIds={f.contactIds} contacts={b.contacts} />
        </div>
      </div>
    </div>
  );
}
