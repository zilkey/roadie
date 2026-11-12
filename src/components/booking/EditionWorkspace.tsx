"use client";
import { Crumbs, campaignsCrumb, sectionCrumb } from "@/components/booking/BookingNav";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { usePlacePitch, PlaceMore } from "@/components/booking/PlacePitchTab";
import { useMemo } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { BackLink, EntityForm, editionForm, hrefFor, useBooking, useNotFound, type Field } from "@/components/booking/common";
import { CardGroup, DetailCard, DetailPage, KV, PitchedPill, SHARED_WARN, useSingleEdit } from "@/components/booking/DetailCards";
import { PitchSummaryCard, usePlaceThreads } from "@/components/booking/PitchSummaryCard";
import { InlineValue } from "@/components/InlineValue";
import { fmtDate, isActive } from "@/lib/booking";
import { fmtLong, showName } from "@/lib/shows";
import { withBandNote } from "@/lib/bandNotes";
import type { Edition, Show } from "@/schema";

/** A edition's one page (#82): Pitch | Festival details. Its own route opens Festival details; its pitch's route opens Pitch. */
export function EditionWorkspace(props: { placeId: string; pitchId?: string; defaultTab: "pitch" | "details" }) { return <AdminOnly><EditionPage {...props} /></AdminOnly>; }

const aboutFields: Field[] = editionForm.fields.filter((x) => x.key !== "payNotes" && x.key !== "notes");
const SURE: Record<string, string> = { estimated: "estimated", target: "our target" };

function EditionPage({ placeId: id, pitchId, defaultTab }: { placeId: string; pitchId?: string; defaultTab: "pitch" | "details" }) {
  const place = usePlacePitch("edition", id, pitchId, defaultTab);
  const router = useRouter();
  const { artistId } = useArtist();
  const { doc: shared, loading } = useDoc<Edition>("editions", id);
  const b = useBooking();
  const threads = usePlaceThreads("festival", shared?.festivalId);
  const showRows = useCollection<Show>("shows", { where: [["artistId", "==", artistId], ["editionId", "==", id]] });
  const { call, error } = useCommand();
  const edit = useSingleEdit<"about">();
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
  // A note saves itself; blank clears it.
  const saveNote = async (key: "payNotes" | "notes", next: string) => !!(await call("editions.update", { id, patch: { [key]: next || null } }));

  return (
    <DetailPage testid="edition-page" recordId={id} back={<Crumbs items={place.crumb ? [campaignsCrumb, place.crumb, { label: name }] : [sectionCrumb("edition"), { label: e.festivalName, href: hrefFor("festival", e.festivalId) }, { label: name }]} back={<BackLink mode="back" href={hrefFor("festival", e.festivalId)} label={e.festivalName} />} />} title={name}
      pill={place.pill}
      meta={e.startDate ? `${fmtDate(e.startDate)}${e.endDate ? `–${fmtDate(e.endDate)}` : ""}` : "Dates not set"}
      more={<PlaceMore bookedIt={place.bookedIt} testid="edition" items={[...place.moreItems, { key: "archive", label: "Archive this year", danger: true, onSelect: archive }]} />}>
      <ErrorBox error={error} />
{place.tabs("Festival details")}
      {place.body}
      {place.tab === "details" && <>
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
        <DetailCard private title="Our notes" testid="edition-notes-card">
          <KV rows={[
            ["Pay", <InlineValue key="pay" testid="edition-pay" label="Pay" kind="text" value={e.payNotes ?? ""} canEdit
              error={error} onSave={(next) => saveNote("payNotes", next)} />],
            ["Notes", <InlineValue key="notes" testid="edition-notes" label="Notes" kind="textarea" value={e.notes ?? ""} canEdit
              error={error} onSave={(next) => saveNote("notes", next)} />],
          ]} />
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
      </>}
    </DetailPage>
  );
}
