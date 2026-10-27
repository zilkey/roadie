"use client";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { useDoc } from "@/lib/firestore-hooks";
import { isActive } from "@/lib/booking";
import {
  BackLink, ContactsPanel, EntityForm, hrefFor, promoterForm, useBooking, useNotFound, type PromoterRow,
} from "@/components/booking/common";
import { CardGroup, DetailCard, DetailPage, KV, PitchedPill, SHARED_WARN, useSingleEdit } from "@/components/booking/DetailCards";
import { PitchSummaryCard } from "@/components/booking/PitchSummaryCard";
import { withBandNote } from "@/lib/bandNotes";
import type { Promoter } from "@/schema";

export default function Page() { return <AdminOnly><PromoterPage /></AdminOnly>; }

const KIND_LABEL: Record<Promoter["kind"], string> = {
  promoter: "Promoter", venueGroup: "Venue group", nonprofit: "Nonprofit", buyer: "Buyer",
};

/** About and Contacts are one record for every band; the pitch, the venues they book for us and our notes are this artist's (promoterNotes). */
const ABOUT_FIELDS = promoterForm.fields.filter((f) => ["name", "kind", "website"].includes(f.key));
const NOTES_FIELDS = promoterForm.fields.filter((f) => ["howToPitch", "notes"].includes(f.key));

function PromoterPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { artistId } = useArtist();
  const { doc: shared, loading } = useDoc<Promoter>("promoters", id);
  const b = useBooking();
  const { call, error, busy } = useCommand();
  const edit = useSingleEdit<"about" | "venues" | "contacts" | "notes">();
  const nf = useNotFound(loading, shared, "promoter");
  if (nf || !shared) return nf;

  const note = b.bandNotes.promoters.get(id);
  const p = withBandNote("promoters", shared, note) as PromoterRow;

  const venues = b.venues.filter((v) => p.venueIds.includes(v.id) || v.promoterIds.includes(p.id));
  const mine = b.pitches.filter((x) => x.artistId === artistId && x.target.kind === "promoter" && x.target.id === id);
  const active = mine.find((x) => isActive(x.status));
  const linkable = b.venues.filter((v) => !venues.some((x) => x.id === v.id));
  const archive = async () => { if (confirm(`Archive ${p.name}?`) && (await call("promoters.remove", { id }))) router.replace("/booking"); };
  const unlinkVenue = (venueId: string) => call("promoters.update", { id, patch: { venueIds: p.venueIds.filter((x) => x !== venueId) } });
  const linkVenue = (venueId: string) => call("promoters.update", { id, patch: { venueIds: [...p.venueIds, venueId] } });

  const website = p.website ? <a className="underline" href={p.website} target="_blank" rel="noreferrer">{p.website}</a> : "";
  const contacts = (
    <ContactsPanel kind="promoters" parentId={id} contactIds={p.contactIds} contacts={b.contacts}
      editing={edit.is("contacts")} onWantEdit={() => edit.open("contacts")} />
  );
  const venueRows = (
    <div className="grid">
      {venues.map((v) => (
        <div key={v.id} className="d-row">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <Link href={hrefFor("venue", v.id)} className="font-bold">{v.name}</Link>
            <span className="s">{v.address.city}</span>
          </div>
          {edit.is("venues") && p.venueIds.includes(v.id) && (
            <button type="button" className="btn danger sm" disabled={busy} onClick={() => unlinkVenue(v.id)}>Remove</button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <DetailPage testid="promoter-page" back={<BackLink href="/booking/promoters" label="All promoters" />} title={p.name}
      pill={active ? <PitchedPill /> : undefined}
      meta={`${KIND_LABEL[p.kind]}${venues.length ? ` · ${venues.length} venues` : ""}`}
      more={<div>
        <Menu label="More actions" testid="promoter" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={[{ key: "archive", label: "Archive promoter", danger: true, onSelect: archive }]} />
      </div>}>
      <ErrorBox error={error} />
      <PitchSummaryCard kind="promoter" id={id} mine={mine} testid="promoter-pitch" />
      <CardGroup kind="shared">
        <DetailCard title="About" edit={edit} editKey="about" warn={SHARED_WARN} editTestid="edit-toggle"
          children={<KV rows={[["Website", website], ["Kind", KIND_LABEL[p.kind]]]} />}
          editChildren={
            <div>
              <EntityForm testid="promoter-edit" fields={ABOUT_FIELDS} initial={promoterForm.initial(p)} build={promoterForm.build}
                autosave={{ command: "promoters.update", id, rev: p.rev, title: p.name }} />
            </div>
          } />

        <DetailCard title="Contacts" edit={edit} editKey="contacts" editTestid="contacts-edit" children={contacts} editChildren={contacts} />

      </CardGroup>

      <CardGroup kind="private">
        <DetailCard private title="Venues they book" edit={edit} editKey="venues" editTestid="venues-edit"
          children={venues.length === 0 ? <div className="empty"><span>None linked yet.</span></div> : venueRows}
          editChildren={
            <>
              {venues.length === 0 ? <div className="empty"><span>None linked yet.</span></div> : venueRows}
              {linkable.length > 0 && (
                <select className="select" value="" disabled={busy}
                  onChange={(e) => { if (e.target.value) void linkVenue(e.target.value); }}>
                  <option value="">Link a venue…</option>
                  {linkable.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              )}
            </>
          } />

        <DetailCard private title="Our notes" edit={edit} editKey="notes" testid="notes-private" editTestid="notes-edit"
          children={<KV rows={[["How to pitch", p.howToPitch ?? ""], ["Notes", p.notes ?? ""]]} />}
          editChildren={
            <div>
              <EntityForm testid="promoter-notes" fields={NOTES_FIELDS} initial={promoterForm.initial(p)} build={promoterForm.build}
                autosave={{ command: "promoters.update", id, rev: note?.rev, title: `${p.name} notes` }} />
            </div>
          } />
      </CardGroup>
    </DetailPage>
  );
}
