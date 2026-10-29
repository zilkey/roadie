"use client";
import { draftPath } from "@/schema/drafts";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { useDraft, useHasDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import {
  BackLink, ContactsPanel, EntityForm, Flagged, FormFields, editionForm, festivalForm, hrefFor, useBooking, useNotFound, type Field, type Values,
} from "@/components/booking/common";
import { CardGroup, DetailCard, DetailPage, KV, PitchedPill, SHARED_WARN, useSingleEdit } from "@/components/booking/DetailCards";
import { FestivalPitchCard, usePlaceThreads } from "@/components/booking/PitchSummaryCard";
import { AddContactDialog, DialogClose, DialogFoot } from "@/components/booking/AddContactDialog";
import { RowX } from "@/components/booking/PickDialog";
import { InlineValue, PlusButton } from "@/components/InlineValue";
import { cityState, fmtDate, isActive } from "@/lib/booking";
import { withBandNote } from "@/lib/bandNotes";
import type { Festival, Show } from "@/schema";

export default function Page() { return <AdminOnly><FestivalPage /></AdminOnly>; }

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i).toLocaleString("en-US", { month: "long" }));
const monthOptions: [string, string][] = [["", "Not sure"], ...MONTHS.map((m, i): [string, string] => [String(i + 1), m])];
const byKey = (k: string) => festivalForm.fields.find((x) => x.key === k)!;
const aboutFields: Field[] = [
  byKey("name"), byKey("website"), byKey("genres"),
  byKey("city"), byKey("state"),
  { key: "typicalMonth", label: "Usually", type: "select", half: true, options: monthOptions },
];

function FestivalPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { artistId } = useArtist();
  const { doc: shared, loading } = useDoc<Festival>("festivals", id);
  const b = useBooking();
  const threads = usePlaceThreads("festival", id);
  const showRows = useCollection<Show>("shows", { where: [["artistId", "==", artistId]] });
  const { call, error } = useCommand();
  const edit = useSingleEdit<"about">();
  const [addingContact, setAddingContact] = useState(false);
  const edPath = draftPath.newUnder("festivals", id, "editions");
  const hasEdDraft = useHasDraft(edPath);
  const [addingEd, setAddingEd] = useState(false);
  const askedEd = useRef(false); // the page-load draft or ?addEdition=1 opens the dialog once; after that a kept draft waits for the plus
  useEffect(() => { if (addingEd) askedEd.current = true; }, [addingEd]);
  useEffect(() => {
    if (askedEd.current) return;
    const asked = new URLSearchParams(window.location.search).get("addEdition") === "1"; // the Festivals tab's "Add edition"
    if (asked || hasEdDraft) { askedEd.current = true; setAddingEd(true); }
  }, [hasEdDraft]);
  const editions = useMemo(() => b.editions.filter((e) => e.festivalId === id).sort((a, c) => c.year - a.year), [b.editions, id]);
  const editionIds = useMemo(() => new Set(editions.map((e) => e.id)), [editions]);
  const mine = useMemo(() => b.pitches.filter((p) => p.artistId === artistId && p.target.kind === "edition" && editionIds.has(p.target.id)), [b.pitches, artistId, editionIds]);
  const nf = useNotFound(loading, shared, "festival");
  if (nf || !shared) return nf;

  const note = b.bandNotes.festivals.get(id);
  const f = withBandNote("festivals", shared, note);

  const archive = async () => { if (confirm(`Archive ${f.name} and its years?`) && (await call("festivals.remove", { id }))) router.replace("/booking"); };
  const active = mine.find((p) => isActive(p.status));
  const myShows = (showRows.rows ?? []).filter((s) => s.editionId && editionIds.has(s.editionId)).sort((a, c) => c.date.localeCompare(a.date));
  const thisYear = new Date().getFullYear();
  const upcoming = editions.find((e) => e.year >= thisYear); // editions are newest first: the newest year that is this year or later
  const pitchCardFlag = !active ? upcoming : undefined; // the edition whose Flagged trigger the Pitch card shows (so Years omits its own)
  const meta = [f.type === "series" ? "Series" : "Festival", cityState(f.address), f.typicalMonth ? `usually ${MONTHS[f.typicalMonth - 1]}` : null].filter(Boolean).join(" · ");

  const contacts = <ContactsPanel kind="festivals" parentId={id} contactIds={f.contactIds} contacts={b.contacts} />;

  return (
    <DetailPage testid="festival-page" back={<BackLink mode="back" href="/booking/festivals" label="All festivals" />} title={f.name}
      pill={active ? <PitchedPill /> : undefined} meta={meta}
      more={<Menu label="More actions" testid="festival" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={[{ key: "archive", label: "Archive festival", danger: true, onSelect: archive }]} />}>
      <ErrorBox error={error} />
      <FestivalPitchCard editions={editions} mine={mine} upcoming={pitchCardFlag} threads={threads} />
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

        <DetailCard title="Years" testid="festival-years" headerExtra={<PlusButton label="Add a year" testid="add-edition" onClick={() => setAddingEd(true)} />}>
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
                      <RowX label={`Delete ${e.label}`} testid={`year-remove-${e.id}`}
                        onClick={() => { if (confirm(`Delete ${e.label}?`)) void call("editions.remove", { id: e.id }); }} />
                      {pitchCardFlag?.id !== e.id && <div className="w-full empty:hidden">{flagForm}</div>}
                    </>)}</Flagged>
                  </div>
                );
              })}
            </div>
          )}
        </DetailCard>

        <AddEditionDialog festival={f} path={edPath} open={addingEd} onClose={() => setAddingEd(false)} />

        <DetailCard title="Contacts" testid="festival-contacts" headerExtra={<PlusButton label="Add a contact" testid="contact-add" onClick={() => setAddingContact(true)} />}>{contacts}</DetailCard>
        <AddContactDialog kind="festivals" parentId={id} parentName={f.name} open={addingContact} onClose={() => setAddingContact(false)} onWantOpen={() => setAddingContact(true)} />

      </CardGroup>

      <CardGroup kind="private">
        <DetailCard private title="Our notes" testid="festival-notes-card">
          <InlineValue testid="festival-notes" label="Notes" kind="textarea" value={f.notes ?? ""} canEdit error={error}
            onSave={async (next) => !!(await call("festivals.update", { id, patch: { notes: next || null } }))} />
        </DetailCard>

        <DetailCard private title="Our shows here" testid="festival-history">
          {myShows.length === 0 ? <div className="empty">No shows yet.</div> : (
            <div>
              {myShows.map((s) => (
                <div key={s.id} className="d-row" data-testid={`festival-show-${s.id}`}>
                  <Link href={`/shows/${s.id}`} className="font-bold">{s.editionName ?? s.venue?.name ?? s.place?.city ?? "Show"}</Link>
                  <span className="d-muted text-sm">{s.date}</span>
                </div>
              ))}
            </div>
          )}
        </DetailCard>
      </CardGroup>
    </DetailPage>
  );
}

/**
 * The Years card's plus: today's new-year fields, kept as a draft (device + server) until "Add year" creates the edition.
 * × and Escape close and keep the draft; Cancel throws it away.
 */
function AddEditionDialog({ festival, path, open, onClose }: { festival: Festival; path: string; open: boolean; onClose(): void }) {
  const { call, error, busy, setError } = useCommand();
  const formId = useId();
  const close = () => { setError(null); onClose(); };
  return (
    <Dialog open={open} onClose={close} title="Add a year" testid="year-add-dialog">
      <DialogClose onClose={close} testid="year-add-close" />
      <span className="s -mt-2">To {festival.name}</span>
      <NewEditionForm path={path} formId={formId} busy={busy} festivalName={festival.name} onCancel={close}
        onCreate={async (data, meta) => { const r = await call("editions.create", { ...data, festivalId: festival.id }, meta); if (r) close(); return !!r; }} />
      <ErrorBox error={error} />
    </Dialog>
  );
}

function NewEditionForm({ path, formId, busy, festivalName, onCreate, onCancel }: {
  path: string; formId: string; busy: boolean; festivalName: string; onCancel(): void;
  onCreate(data: Record<string, unknown>, meta: { clientMutationId: string; clearDraft: string }): Promise<boolean>;
}) {
  const d = useDraft<Values>(path, editionForm.blank, { title: (v) => `New year · ${festivalName} ${v.label ?? ""}`.trim() });
  const mutationId = useRef(newMutationId());
  const [sending, setSending] = useState(false);
  if (!d.ready) return null;
  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setSending(true);
    try {
      await d.settle();
      if (await onCreate(editionForm.build(d.value), { clientMutationId: mutationId.current, clearDraft: d.draftId })) {
        await d.clear({ reset: true }); mutationId.current = newMutationId();
      }
    } finally { setSending(false); }
  }
  return (
    <>
      <form id={formId} onSubmit={submit} className="grid gap-2" data-testid="new-edition">
        <FormFields fields={editionForm.fields} v={d.value} set={(k, val) => d.setValue((x) => ({ ...x, [k]: val }))} testid="new-edition" />
        <span className="s">Half-finished? It&apos;s kept as a draft until you press Add year.</span>
        <DraftNote restoredAt={d.restoredAt} status={d.status} onStartOver={() => void d.clear({ reset: true })} />
      </form>
      <DialogFoot cancelTestid="new-edition-cancel" onCancel={onCancel}>
        <button type="submit" form={formId} className="btn acc" disabled={busy || sending} data-testid="new-edition-submit">Add year</button>
      </DialogFoot>
    </>
  );
}
