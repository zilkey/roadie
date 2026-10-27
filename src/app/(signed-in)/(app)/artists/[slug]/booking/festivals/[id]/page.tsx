"use client";
import { draftPath } from "@/schema/drafts";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { SaveStatus } from "@/components/SaveStatus";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { useHasDraft } from "@/lib/drafts";
import { useAutosave } from "@/lib/autosave";
import {
  BackLink, ContactsPanel, EntityForm, Flagged, FlagIcon, PitchLinks, editionForm, festivalForm, hrefFor, useBooking, useNotFound, type Field,
} from "@/components/booking/common";
import { CardGroup, DetailCard, DetailPage, KV, PitchedPill, SHARED_WARN, useSingleEdit } from "@/components/booking/DetailCards";
import { cityState, fmtDate, isActive } from "@/lib/booking";
import { withBandNote } from "@/lib/bandNotes";
import type { Edition, Festival, Show } from "@/schema";

export default function Page() { return <AdminOnly><FestivalPage /></AdminOnly>; }

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i).toLocaleString("en-US", { month: "long" }));
const monthOptions: [string, string][] = [["", "Not sure"], ...MONTHS.map((m, i): [string, string] => [String(i + 1), m])];
const byKey = (k: string) => festivalForm.fields.find((x) => x.key === k)!;
const aboutFields: Field[] = [
  byKey("name"), byKey("website"), byKey("genres"),
  byKey("city"), byKey("state"),
  { key: "typicalMonth", label: "Usually", type: "select", half: true, options: monthOptions },
];
const notesFields: Field[] = [byKey("notes")];

function FestivalPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { artistId } = useArtist();
  const { doc: shared, loading } = useDoc<Festival>("festivals", id);
  const b = useBooking();
  const showRows = useCollection<Show>("shows", { where: [["artistId", "==", artistId]] });
  const { call, error } = useCommand();
  const edit = useSingleEdit<"about" | "years" | "contacts" | "notes">();
  const openEdit = edit.open;
  const hasEdDraft = useHasDraft(draftPath.newUnder("festivals", id, "editions"));
  const [addEdX, setAddEd] = useState<boolean | null>(null);
  const [askedEd] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("addEdition") === "1");
  const addEd = addEdX ?? (askedEd || hasEdDraft); // an unfinished year, or ?addEdition=1 (the Festivals tab's "Add edition"), opens the form
  useEffect(() => { if (addEd) openEdit("years"); }, [addEd, openEdit]);
  const editions = useMemo(() => b.editions.filter((e) => e.festivalId === id).sort((a, c) => c.year - a.year), [b.editions, id]);
  const editionIds = useMemo(() => new Set(editions.map((e) => e.id)), [editions]);
  const mine = useMemo(() => b.pitches.filter((p) => p.artistId === artistId && p.target.kind === "edition" && editionIds.has(p.target.id)), [b.pitches, artistId, editionIds]);
  const nf = useNotFound(loading, shared, "festival");
  if (nf || !shared) return nf;

  const note = b.bandNotes.festivals.get(id);
  const f = withBandNote("festivals", shared, note);

  const archive = async () => { if (confirm(`Archive ${f.name} and its years?`) && (await call("festivals.remove", { id }))) router.replace("/booking"); };
  const active = mine.find((p) => isActive(p.status));
  const activeEd = active ? editions.find((e) => e.id === active.target.id) : undefined;
  const past = mine.filter((p) => !isActive(p.status));
  const myShows = (showRows.rows ?? []).filter((s) => s.editionId && editionIds.has(s.editionId)).sort((a, c) => c.date.localeCompare(a.date));
  const thisYear = new Date().getFullYear();
  const upcoming = editions.find((e) => e.year >= thisYear); // editions are newest first: the newest year that is this year or later
  const pitchCardFlag = !active ? upcoming : undefined; // the edition whose Flagged trigger the Pitch card shows (so Years omits its own)
  const meta = [f.type === "series" ? "Series" : "Festival", cityState(f.address), f.typicalMonth ? `usually ${MONTHS[f.typicalMonth - 1]}` : null].filter(Boolean).join(" · ");

  const contacts = <ContactsPanel kind="festivals" parentId={id} contactIds={f.contactIds} contacts={b.contacts} editing={edit.is("contacts")} onWantEdit={() => edit.open("contacts")} />;

  return (
    <DetailPage testid="festival-page" back={<BackLink href="/booking/festivals" label="All festivals" />} title={f.name}
      pill={active ? <PitchedPill /> : undefined} meta={meta}
      more={<Menu label="More actions" testid="festival" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={[{ key: "archive", label: "Archive festival", danger: true, onSelect: archive }]} />}>
      <ErrorBox error={error} />
      <CardGroup kind="shared">
        <DetailCard title="About the festival" editKey="about" edit={edit} warn={SHARED_WARN} testid="festival-about" editTestid="edit-toggle"
          editChildren={
            <div>
              <EntityForm testid="festival-edit" fields={aboutFields} initial={festivalForm.initial(f)} build={festivalForm.build}
                autosave={{ command: "festivals.update", id, rev: f.rev, title: f.name }} />
            </div>
          }>
          <KV rows={[
            ["Website", f.website ? <a className="underline" href={/^https?:\/\//.test(f.website) ? f.website : `https://${f.website}`} target="_blank" rel="noreferrer">{f.website}</a> : ""],
            ["Genres", f.genres ?? ""],
            ["Where", cityState(f.address)],
            ["Usually", f.typicalMonth ? MONTHS[f.typicalMonth - 1] : ""],
          ]} />
        </DetailCard>

        <DetailCard title="Years" editKey="years" edit={edit} testid="festival-years" editTestid="years-edit" doneTestid="years-done"
          editChildren={
            <div className="grid gap-3">
              {editions.map((e) => <EditionRow key={e.id} e={e} festival={f} />)}
              {editions.length === 0 && <div className="empty">No dates yet.</div>}
              <button type="button" className="btn ghost sm justify-self-start" onClick={() => setAddEd(!addEd)} data-testid="add-edition">{addEd ? "Close" : "+ Add a year"}</button>
              {addEd && (
                <EntityForm testid="new-edition" fields={editionForm.fields} initial={editionForm.blank} build={editionForm.build} submitLabel="Add year"
                  onCancel={() => setAddEd(false)}
                  draft={{ path: draftPath.newUnder("festivals", id, "editions"), title: (v) => `New year · ${f.name} ${v.label ?? ""}`.trim() }}
                  onSubmit={async (d, meta) => { const r = await call("editions.create", { ...d, festivalId: id }, meta); if (r) setAddEd(false); return !!r; }} />
              )}
            </div>
          }>
          {editions.length === 0 ? <div className="empty">No dates yet.</div> : (
            <div>
              {editions.map((e) => {
                const dates = [
                  e.startDate && `${fmtDate(e.startDate)}${e.endDate ? `–${fmtDate(e.endDate)}` : ""}`,
                  e.appOpens && `applications open ${fmtDate(e.appOpens.date)}`,
                  e.appDeadline && `close ${fmtDate(e.appDeadline.date)}${e.appOpens?.sure === "estimated" || e.appDeadline.sure === "estimated" ? " (estimated)" : ""}`,
                ].filter(Boolean).join(" · ");
                return (
                  <div key={e.id} className="d-row" data-testid={`edition-${e.id}`}>
                    <Flagged kind="edition" id={e.id} pitches={b.pitches.filter((p) => p.artistId === artistId)}>{(flag, flagForm) => (<>
                      <div className="grid min-w-0 gap-0.5">
                        <Link href={hrefFor("edition", e.id)} className="font-bold">{e.label}</Link>
                        {dates && <span className="d-muted text-sm">{dates}</span>}
                      </div>
                      {pitchCardFlag?.id !== e.id && flag}
                      {pitchCardFlag?.id !== e.id && <div className="w-full empty:hidden">{flagForm}</div>}
                    </>)}</Flagged>
                  </div>
                );
              })}
            </div>
          )}
        </DetailCard>

        <DetailCard title="Contacts" editKey="contacts" edit={edit} testid="festival-contacts" editTestid="contacts-edit" editChildren={contacts}>{contacts}</DetailCard>

      </CardGroup>

      <CardGroup kind="private">
        <DetailCard private title="Pitch" testid="festival-pitch"
          icon={<span className="inline-flex" style={{ color: active ? "var(--pitched)" : "var(--muted)" }}><FlagIcon filled={!!active} /></span>}>
          {active && activeEd ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{activeEd.label} is on the Pitch List</span>
                <Link href={`/booking/pitches/${active.id}`} className="underline">Open pitch</Link>
              </div>
              <Flagged kind="edition" id={activeEd.id} pitches={mine}>{(_btn, _form, strip) => strip}</Flagged>
            </div>
          ) : !pitchCardFlag ? (
            <span className="d-muted">{editions.length === 0 ? "Not on the Pitch List. Add a year first." : "Not on the Pitch List."}</span>
          ) : (
            <div className="grid gap-3">
              <Flagged kind="edition" id={pitchCardFlag.id} pitches={mine} label={`Add ${pitchCardFlag.label} to the Pitch List`}>{(flag, flagForm) => (<>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="d-muted">Not on the Pitch List.{pitchCardFlag.appOpens ? ` ${pitchCardFlag.label} applications open ${fmtDate(pitchCardFlag.appOpens.date)}.` : ""}</span>
                  {flag}
                </div>
                {flagForm}
              </>)}</Flagged>
            </div>
          )}
        </DetailCard>

        <DetailCard private title="Our notes" editKey="notes" edit={edit} testid="festival-notes-card" editTestid="notes-edit"
          editChildren={
            <div>
              <EntityForm testid="festival-notes" fields={notesFields} initial={festivalForm.initial(f)} build={festivalForm.build}
                autosave={{ command: "festivals.update", id, rev: note?.rev, title: `${f.name} notes` }} />
            </div>
          }>
          {f.notes ? <p className="m-0 whitespace-pre-wrap">{f.notes}</p> : <span className="d-muted">—</span>}
        </DetailCard>

        <DetailCard private title={`Our history here (${past.length + myShows.length})`} testid="festival-history">
          {past.length + myShows.length === 0 ? <div className="empty">No past pitches or shows yet.</div> : (
            <div className="grid gap-3">
              {past.length > 0 && <PitchLinks pitches={past} />}
              {myShows.length > 0 && (
                <div>
                  {myShows.map((s) => (
                    <div key={s.id} className="d-row" data-testid={`festival-show-${s.id}`}>
                      <Link href={`/shows/${s.id}`} className="font-bold">{s.editionName ?? s.venue?.name ?? s.place?.city ?? "Show"}</Link>
                      <span className="d-muted text-sm">{s.date}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DetailCard>
      </CardGroup>
    </DetailPage>
  );
}

/** One year while its card is editing: every field autosaves as a patch on the edition. */
function EditionRow({ e, festival }: { e: Edition; festival: Festival }) {
  const as = useAutosave({ command: "editions.update", id: e.id, rev: e.rev, title: `${festival.name} ${e.label}` });
  const [year, setYear] = useState(String(e.year));
  const docEst = [e.appOpens?.sure, e.appDeadline?.sure].some((s) => s === "estimated");
  const hasDocDates = !!(e.appOpens || e.appDeadline);
  const [est, setEst] = useState(hasDocDates ? docEst : true);
  useEffect(() => { if (!as.isBusy()) setYear(String(e.year)); }, [e.year]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (hasDocDates) setEst(docEst); }, [hasDocDates, docEst]);
  const sureFor = (cur?: string) => (cur ?? (est ? "estimated" : "confirmed"));
  const opens = as.bind("appOpens", e.appOpens?.date ?? "", { toPatch: (s) => (s ? { date: s, sure: sureFor(e.appOpens?.sure) } : null) });
  const closes = as.bind("appDeadline", e.appDeadline?.date ?? "", { toPatch: (s) => (s ? { date: s, sure: sureFor(e.appDeadline?.sure) } : null) });
  const onYear = (val: string) => {
    setYear(val);
    const n = Number(val);
    if (!val.trim() || !Number.isInteger(n)) return;
    as.patch(e.label === String(e.year) ? { year: n, label: String(n) } : { year: n });
  };
  const onEst = (checked: boolean) => {
    setEst(checked);
    const sure = checked ? "estimated" : "confirmed";
    const p: Record<string, unknown> = {};
    if (opens.value) p.appOpens = { date: opens.value, sure };
    if (closes.value) p.appDeadline = { date: closes.value, sure };
    as.patch(p);
  };
  const tid = `edition-edit-${e.id}`;
  return (
    <div className="grid gap-2 border-b border-[var(--divider)] pb-3 last:border-b-0" data-testid={`edition-${e.id}`}>
      <div className="grid grid-cols-2 gap-2" onBlur={() => void as.flush()}>
        <label className="grid gap-1"><span className="lbl">Year</span>
          <input className="input" type="number" value={year} onChange={(ev) => onYear(ev.target.value)} data-testid={`${tid}-year`} /></label>
        <span aria-hidden />
        <label className="grid gap-1"><span className="lbl">Starts</span>
          <input className="input" type="date" data-testid={`${tid}-startDate`} {...as.bind("startDate", e.startDate ?? "")} /></label>
        <label className="grid gap-1"><span className="lbl">Ends</span>
          <input className="input" type="date" data-testid={`${tid}-endDate`} {...as.bind("endDate", e.endDate ?? "")} /></label>
        <label className="grid gap-1"><span className="lbl">Applications open</span>
          <input className="input" type="date" data-testid={`${tid}-appOpens`} {...opens} /></label>
        <label className="grid gap-1"><span className="lbl">Applications close</span>
          <input className="input" type="date" data-testid={`${tid}-appDeadline`} {...closes} /></label>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={est} onChange={(ev) => onEst(ev.target.checked)} data-testid={`${tid}-estimated`} />Dates are estimated</label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SaveStatus {...as.statusProps} />
        <Link href={hrefFor("edition", e.id)} className="d-muted text-sm underline">Open year page</Link>
      </div>
    </div>
  );
}
