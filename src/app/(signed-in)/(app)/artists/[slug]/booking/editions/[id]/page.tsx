"use client";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { BackLink, EntityForm, editionForm, hrefFor, useBooking, useNotFound, type Field } from "@/components/booking/common";
import { CardGroup, DetailCard, DetailPage, KV, PitchedPill, SHARED_WARN, useSingleEdit } from "@/components/booking/DetailCards";
import { PitchSummaryCard } from "@/components/booking/PitchSummaryCard";
import { fmtDate, isActive } from "@/lib/booking";
import { fmtLong, showName } from "@/lib/shows";
import { withBandNote } from "@/lib/bandNotes";
import type { Edition, Show } from "@/schema";

export default function Page() { return <AdminOnly><EditionPage /></AdminOnly>; }

const byKey = (k: string) => editionForm.fields.find((x) => x.key === k)!;
const aboutFields: Field[] = editionForm.fields.filter((x) => x.key !== "payNotes" && x.key !== "notes");
const notesFields: Field[] = [byKey("payNotes"), byKey("notes")];
const SURE: Record<string, string> = { estimated: "estimated", target: "our target" };

function EditionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { artistId } = useArtist();
  const { doc: shared, loading } = useDoc<Edition>("editions", id);
  const b = useBooking();
  const showRows = useCollection<Show>("shows", { where: [["artistId", "==", artistId], ["editionId", "==", id]] });
  const { call, error } = useCommand();
  const edit = useSingleEdit<"about" | "notes">();
  const mine = useMemo(() => b.pitches.filter((p) => p.artistId === artistId && p.target.kind === "edition" && p.target.id === id), [b.pitches, artistId, id]);
  const nf = useNotFound(loading, shared, "year");
  if (nf || !shared) return nf;

  const note = b.bandNotes.editions.get(id);
  const e = withBandNote("editions", shared, note);

  const name = `${e.festivalName} ${e.label}`;
  const archive = async () => { if (confirm("Archive this year?") && (await call("editions.remove", { id }))) router.replace(hrefFor("festival", e.festivalId)); };
  const active = mine.find((p) => isActive(p.status));
  const myShows = [...(showRows.rows ?? [])].sort((a, c) => c.date.localeCompare(a.date));
  const dated = (d: { date: string; sure: string } | undefined) => d && <>{fmtDate(d.date)}{SURE[d.sure] && <span className="d-muted"> ({SURE[d.sure]})</span>}</>;
  const autosave = { command: "editions.update", id, rev: e.rev, title: name };

  return (
    <DetailPage testid="edition-page" back={<BackLink href={hrefFor("festival", e.festivalId)} label={e.festivalName} />} title={name}
      pill={active ? <PitchedPill /> : undefined}
      meta={e.startDate ? `${fmtDate(e.startDate)}${e.endDate ? `–${fmtDate(e.endDate)}` : ""}` : "Dates not set"}
      more={<Menu label="More actions" testid="edition" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={[{ key: "archive", label: "Archive this year", danger: true, onSelect: archive }]} />}>
      <ErrorBox error={error} />
      <PitchSummaryCard kind="edition" id={id} mine={mine} testid="edition-pitch" />
      <CardGroup kind="shared">
        <DetailCard title="About this year" editKey="about" edit={edit} warn={SHARED_WARN} testid="edition-facts" editTestid="edit-toggle"
          editChildren={<div><EntityForm testid="edition-edit" fields={aboutFields} initial={editionForm.initial(e)} build={editionForm.build} autosave={autosave} /></div>}>
          <KV rows={[
            ["Dates", e.startDate ? `${fmtDate(e.startDate)}${e.endDate ? `–${fmtDate(e.endDate)}` : ""}` : ""],
            ["Applications open", dated(e.appOpens)],
            ["Deadline", dated(e.appDeadline)],
            ["Decision by", e.notifyDate ? fmtDate(e.notifyDate) : ""],
            ["Apply link", e.applyUrl ? <a className="underline" href={e.applyUrl} target="_blank" rel="noreferrer">{e.applyUrl}</a> : ""],
          ]} />
        </DetailCard>

      </CardGroup>

      <CardGroup kind="private">
        <DetailCard private title="Our notes" editKey="notes" edit={edit} testid="edition-notes-card" editTestid="notes-edit"
          editChildren={<div><EntityForm testid="edition-notes" fields={notesFields} initial={editionForm.initial(e)} build={editionForm.build} autosave={{ ...autosave, rev: note?.rev, title: `${name} notes` }} /></div>}>
          <KV rows={[["Pay", e.payNotes ?? ""], ["Notes", e.notes ?? ""]]} />
        </DetailCard>

        <DetailCard private title="Our shows here" testid="edition-history">
          {myShows.length === 0 ? <div className="empty">No shows yet.</div> : (
            <div data-testid="edition-shows">
              {myShows.map((s) => (
                <div key={s.id} className="d-row" data-testid={`edition-show-${s.id}`}>
                  <Link href={`/shows/${s.id}`} className="font-bold">{showName(s)}</Link>
                  <span className="d-muted text-sm">{fmtLong(s.date)} {s.date.slice(0, 4)}</span>
                </div>
              ))}
            </div>
          )}
        </DetailCard>
      </CardGroup>
    </DetailPage>
  );
}
