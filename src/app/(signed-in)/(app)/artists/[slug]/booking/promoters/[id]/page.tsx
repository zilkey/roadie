"use client";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { useDoc } from "@/lib/firestore-hooks";
import { isActive } from "@/lib/booking";
import {
  BackLink, ContactsPanel, EntityForm, hrefFor, promoterForm, useBooking, useNotFound, type PromoterRow,
} from "@/components/booking/common";
import { CardGroup, DetailCard, DetailPage, KV, PitchedPill, SHARED_WARN, useSingleEdit } from "@/components/booking/DetailCards";
import { PitchSummaryCard, usePlaceThreads } from "@/components/booking/PitchSummaryCard";
import { AddContactDialog } from "@/components/booking/AddContactDialog";
import { InlineValue, PlusButton } from "@/components/InlineValue";
import { PickDialog, RowX } from "@/components/booking/PickDialog";
import { withBandNote } from "@/lib/bandNotes";
import type { Promoter } from "@/schema";

export default function Page() { return <AdminOnly><PromoterPage /></AdminOnly>; }

const KIND_LABEL: Record<Promoter["kind"], string> = {
  promoter: "Promoter", venueGroup: "Venue group", nonprofit: "Nonprofit", buyer: "Buyer",
};

/** About and Contacts are one record for every band; the pitch, the venues they book for us and our notes are this artist's (promoterNotes). */
const ABOUT_FIELDS = promoterForm.fields.filter((f) => ["name", "kind", "website"].includes(f.key));

function PromoterPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { artistId } = useArtist();
  const { doc: shared, loading } = useDoc<Promoter>("promoters", id);
  const b = useBooking();
  const threads = usePlaceThreads("promoter", id);
  const { call, error, busy, setError } = useCommand();
  const edit = useSingleEdit<"about">();
  const [addingContact, setAddingContact] = useState(false);
  const [linkingVenue, setLinkingVenue] = useState(false);
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
  // A note saves itself; blank clears it.
  const saveNote = async (key: "howToPitch" | "notes", next: string) => !!(await call("promoters.update", { id, patch: { [key]: next || null } }));

  const website = p.website ? <a className="underline" href={p.website} target="_blank" rel="noreferrer">{p.website}</a> : "";
  const contacts = (
    <ContactsPanel kind="promoters" parentId={id} contactIds={p.contactIds} contacts={b.contacts} />
  );
  const venueRows = (
    <div className="grid">
      {venues.map((v) => (
        <div key={v.id} className="d-row" data-testid={`venue-${v.name}`}>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <Link href={hrefFor("venue", v.id)} className="font-bold">{v.name}</Link>
            <span className="s">{v.address.city}</span>
          </div>
          {p.venueIds.includes(v.id) && (
            <RowX label={`Remove ${v.name} from this promoter`} disabled={busy} testid={`venue-remove-${v.name}`} onClick={() => void unlinkVenue(v.id)} />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <DetailPage testid="promoter-page" back={<BackLink mode="back" href="/booking/promoters" label="All promoters" />} title={p.name}
      pill={active ? <PitchedPill /> : undefined}
      meta={`${KIND_LABEL[p.kind]}${venues.length ? ` · ${venues.length} venues` : ""}`}
      more={<div>
        <Menu label="More actions" testid="promoter" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={[{ key: "archive", label: "Archive promoter", danger: true, onSelect: archive }]} />
      </div>}>
      <ErrorBox error={error} />
      <PitchSummaryCard kind="promoter" id={id} mine={mine} threads={threads} testid="promoter-pitch" />
      <CardGroup kind="shared">
        <DetailCard title="About" edit={edit} editKey="about" warn={SHARED_WARN} editTestid="edit-toggle"
          children={<KV rows={[["Website", website], ["Kind", KIND_LABEL[p.kind]]]} />}
          editChildren={
            <div>
              <EntityForm testid="promoter-edit" fields={ABOUT_FIELDS} initial={promoterForm.initial(p)} build={promoterForm.build}
                autosave={{ command: "promoters.update", id, rev: p.rev, title: p.name }} />
            </div>
          } />

        <DetailCard title="Contacts" headerExtra={<PlusButton label="Add a contact" testid="contact-add" onClick={() => setAddingContact(true)} />} children={contacts} />
        <AddContactDialog kind="promoters" parentId={id} parentName={p.name} open={addingContact} onClose={() => setAddingContact(false)} onWantOpen={() => setAddingContact(true)} />

      </CardGroup>

      <CardGroup kind="private">
        <DetailCard private title="Venues they book" testid="promoter-venues"
          headerExtra={<PlusButton label="Link a venue" testid="venues-add" onClick={() => setLinkingVenue(true)} />}
          children={venues.length === 0 ? <div className="empty"><span>None linked yet.</span></div> : venueRows} />
        <PickDialog open={linkingVenue} onClose={() => { setError(null); setLinkingVenue(false); }} title="Link a venue" subtitle={`To ${p.name}`} testid="venues-add"
          findLabel="Find it" placeholder="Venue name or city" addLabel="Link venue" busy={busy} error={error}
          items={linkable.map((v) => ({ id: v.id, name: v.name, sub: v.address.city }))}
          onPick={async (venueId) => !!(await linkVenue(venueId))} />

        <DetailCard private title="Our notes" testid="notes-private">
          <KV rows={[
            ["How to pitch", <InlineValue key="pitch" testid="promoter-howtopitch" label="How to pitch" kind="textarea" value={p.howToPitch ?? ""} canEdit
              error={error} onSave={(next) => saveNote("howToPitch", next)} />],
            ["Notes", <InlineValue key="notes" testid="promoter-notes" label="Notes" kind="textarea" value={p.notes ?? ""} canEdit
              error={error} onSave={(next) => saveNote("notes", next)} />],
          ]} />
        </DetailCard>
      </CardGroup>
    </DetailPage>
  );
}
