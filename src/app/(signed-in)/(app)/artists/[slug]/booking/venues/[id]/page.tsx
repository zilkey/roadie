"use client";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { CardGroup, DetailCard, DetailPage, KV, PitchedPill, VENUE_SHARED_WARN, useSingleEdit } from "@/components/booking/DetailCards";
import { PitchSummaryCard, usePlaceThreads } from "@/components/booking/PitchSummaryCard";
import { AddContactDialog } from "@/components/booking/AddContactDialog";
import { InlineValue, PlusButton } from "@/components/InlineValue";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import {
  BackLink, ContactsPanel, EntityForm, hrefFor, roomForm, useBooking, useNotFound, type VenueRow,
} from "@/components/booking/common";
import { fmtDate, isActive } from "@/lib/booking";
import { privateOf } from "@/lib/venues";
import { useVenueTypes, venueTypeLabel } from "@/lib/venueTypes";
import type { Show, Venue } from "@/schema";

const ROOM_KEYS = ["name", "street", "city", "state", "zip", "type", "capacity", "website"];
const roomFields = ROOM_KEYS.map((k) => roomForm.fields.find((f) => f.key === k)!);
const href = (u: string) => (u.startsWith("http") ? u : `https://${u}`);

/**
 * A venue is two documents shown as a single column of cards. "About the room" is shared with every band (autosaved; the card warns
 * who sees it). The private group (admins only) is this band's pitch, contacts, notes, promoters and shows. Everything autosaves; Done closes a card.
 */
export default function VenuePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { role, artistId } = useArtist();
  const admin = role === "admin";
  const { doc: v, loading } = useDoc<Venue>("venues", id, { includeDeleted: true });
  const b = useBooking();
  const threads = usePlaceThreads("venue", id);
  const types = useVenueTypes();
  const shows = useCollection<Show>("shows", { where: [["venue.id", "==", id], ["artistId", "==", artistId]] });
  const { call, error } = useCommand();
  const edit = useSingleEdit<"about" | "contacts">();
  const [merging, setMerging] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [linking, setLinking] = useState(false); // the Booked by plus shows the promoter picker
  const mergedInto = v?.deletedAt ? v.mergedInto : undefined;
  useEffect(() => { if (mergedInto) router.replace(hrefFor("venue", mergedInto)); }, [mergedInto, router]);
  const nf = useNotFound(loading, v && !v.deletedAt ? v : null, "venue");
  if (mergedInto) return <div className="card" data-testid="merged-redirect">This venue was merged into another one. Taking you there…</div>;
  if (nf || !v) return nf;

  const note = b.venueNotes.get(id);
  const mine = privateOf(note ?? v);
  const archived = !!note?.deletedAt;
  const promoters = b.promoters.filter((p) => mine.promoterIds.includes(p.id) || p.venueIds.includes(v.id));
  const pitches = b.pitches.filter((p) => p.target.kind === "venue" && p.target.id === id);
  const pitched = pitches.some((p) => p.artistId === artistId && isActive(p.status));
  const past = [...(shows.rows ?? [])].sort((a, c) => c.date.localeCompare(a.date));
  const archiveVenue = async () => { if (confirm(`Archive ${v.name} for your band? It leaves your lists; other bands keep it.`) && (await call("venues.remove", { id }))) router.replace("/booking"); };

  const street = [v.address.street, v.address.city, [v.address.state, v.address.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(street)}`;
  const typeLabel = venueTypeLabel(types, v.type);
  const unlink = (pid: string) => call("venues.update", { id, patch: { promoterIds: mine.promoterIds.filter((x) => x !== pid) } });
  const canLink = b.promoters.some((p) => !promoters.some((x) => x.id === p.id));
  // A note saves itself; blank clears it.
  const saveNote = async (key: "loadInNotes" | "notes", next: string) => !!(await call("venues.update", { id, patch: { [key]: next || null } }));
  const contacts = <ContactsPanel kind="venues" parentId={id} contactIds={mine.contactIds} contacts={b.contacts} roles={mine} pitchId={b.pitches.find((p) => p.target.kind === "venue" && p.target.id === id && isActive(p.status))?.id} />;

  return (
    <DetailPage testid="venue-page"
      back={<BackLink mode="back" href={admin ? "/booking/venues" : "/shows"} label={admin ? "All venues" : "Shows"} />}
      title={v.name}
      pill={admin && pitched ? <PitchedPill /> : undefined}
      meta={[typeLabel, v.address.city].filter(Boolean).join(" · ")}
      more={admin && !archived ? (
        <Menu label="More actions" testid="venue" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={[
          { key: "merge", label: "Merge into another venue…", onSelect: () => setMerging(true) },
          { key: "archive", label: "Archive venue", danger: true, onSelect: archiveVenue },
        ]} />
      ) : undefined}>
      <ErrorBox error={error} />
      {archived && (
        <div className="card hi" data-testid="venue-archived">
          <span>You archived this venue for your band. Other bands still see it.</span>
          <div><button className="btn ghost sm" data-testid="venue-unarchive"
            onClick={() => call("venues.create", { name: v.name, type: v.type, address: v.address, region: v.region })}>Bring it back to our lists</button></div>
        </div>
      )}
      {admin && <PitchSummaryCard kind="venue" id={id} mine={pitches.filter((p) => p.artistId === artistId)} threads={threads} testid="venue-pitch-card" />}
      <CardGroup kind="shared">
        <DetailCard title="About the room" editKey="about" edit={edit} warn={VENUE_SHARED_WARN} testid="room-card" editTestid="room-edit" doneTestid="room-save"
          editChildren={
            <div data-testid="room-form">
              <EntityForm testid="room" fields={roomFields} initial={roomForm.initial(v)} build={roomForm.build}
                autosave={{ command: "venues.update", id, rev: v.rev, title: v.name }} />
            </div>
          }>
          <KV rows={[
            ["Address", street ? <>{street} · <a className="underline" href={mapsUrl} target="_blank" rel="noreferrer">Open in Google Maps ↗</a></> : "", "room-address"],
            ["Type", typeLabel, "room-type"],
            ["Capacity", v.capacity ?? "", "room-capacity"],
            ["Website", v.website ? <a className="underline" href={href(v.website)} target="_blank" rel="noreferrer">{v.website}</a> : "", "room-website"],
          ]} />
        </DetailCard>
      </CardGroup>
      {admin && (
        <CardGroup kind="private">
          <DetailCard private title="Contacts" testid="contacts-card" headerExtra={<PlusButton label="Add a contact" testid="contact-add" onClick={() => setAddingContact(true)} />}>{contacts}</DetailCard>
          <AddContactDialog kind="venues" parentId={id} parentName={v.name} open={addingContact} onClose={() => setAddingContact(false)} onWantOpen={() => setAddingContact(true)} />
          <DetailCard private title="Our notes" testid="notes-private">
            <KV rows={[
              ["Booked by", (
                <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
                  {promoters.length === 0 && <span className="d-muted">Books directly</span>}
                  {promoters.map((p) => (
                    <span key={p.id} className="group inline-flex items-center">
                      <Link href={hrefFor("promoter", p.id)} className="underline" data-testid={`booked-by-${p.id}`}>{p.name}</Link>
                      {/* A promoter that lists this venue itself has no ×: unlink it from the promoter's page. */}
                      {mine.promoterIds.includes(p.id) && (
                        <button type="button" className="row-x group-hover:opacity-100" aria-label={`Unlink ${p.name}`} title={`Unlink ${p.name}`}
                          data-testid={`booked-by-remove-${p.id}`} onClick={() => void unlink(p.id)}><XIcon /></button>
                      )}
                    </span>
                  ))}
                  {linking ? <PromoterPicker venueId={id} current={mine.promoterIds} all={b.promoters} call={call} onClose={() => setLinking(false)} />
                    : canLink && <PlusButton label="Link a promoter" className="!h-9 !w-9" onClick={() => setLinking(true)} testid="booked-by-add" />}
                </div>
              )],
              ["Load-in", <InlineValue key="loadin" testid="venue-loadin" label="Load-in" kind="textarea" value={mine.loadInNotes ?? ""} canEdit
                onSave={(next) => saveNote("loadInNotes", next)} error={error} />],
              ["Notes", <InlineValue key="notes" testid="venue-notes" label="Notes" kind="textarea" value={mine.notes ?? ""} canEdit
                placeholder="Anything the band should know" onSave={(next) => saveNote("notes", next)} error={error} />],
            ]} />
          </DetailCard>
          <DetailCard private title={`Our shows here (${past.length})`}>
            {past.length === 0 ? <div className="empty" data-testid="no-shows">None yet. Shows appear here once you book one.</div> : (
              <div className="grid gap-2" data-testid="venue-shows">
                {past.map((s) => (
                  <Link key={s.id} href={`/shows/${s.id}`} data-testid={`venue-show-${s.id}`} className="flex flex-wrap items-baseline gap-x-3"><b>{fmtDate(s.date)} {s.date.slice(0, 4)}</b><span className="s">{s.status}{s.editionName ? ` · ${s.editionName}` : ""}</span></Link>
                ))}
              </div>
            )}
          </DetailCard>
        </CardGroup>
      )}
      {admin && <MergePanel v={v} venues={b.venues} open={merging} onClose={() => setMerging(false)} onDone={(into) => router.replace(hrefFor("venue", into))} />}
    </DetailPage>
  );
}

/** The Merge dialog (opened from the More menu): pick the room to keep, confirm, and every band's shows, pitches and notes move to it. */
function MergePanel({ v, venues, open, onClose, onDone }: { v: Venue & { id: string }; venues: VenueRow[]; open: boolean; onClose(): void; onDone(into: string): void }) {
  const [q, setQ] = useState("");
  const [into, setInto] = useState<VenueRow | null>(null);
  const { call, error, busy, setError } = useCommand();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = venues.filter((x) => x.id !== v.id && words.every((w) => `${x.name} ${x.address.city}`.toLowerCase().includes(w))).slice(0, 8);
  function close() { onClose(); setQ(""); setInto(null); setError(null); }
  async function merge() {
    if (!into) return;
    const r = await call("venues.mergeInto", { from: v.id, into: into.id });
    if (r) { close(); onDone(into.id); }
  }
  return (
    <>
      <Dialog open={open} onClose={close} title={into ? "Merge these two venues?" : `Merge ${v.name} into…`} testid="merge-dialog">
        {!into ? (
          <>
            <input className="input" placeholder="Search venues by name or city" value={q} onChange={(e) => setQ(e.target.value)} data-testid="merge-search" autoFocus />
            <div className="grid gap-1" data-testid="merge-results">
              {q.trim() && hits.length === 0 && <span className="s">No venue matches.</span>}
              {hits.map((x) => (
                <button key={x.id} type="button" className="card text-left" onClick={() => setInto(x)} data-testid={`merge-pick-${x.id}`}><b>{x.name}</b><span className="s">{x.address.city}, {x.address.state}</span></button>
              ))}
            </div>
            <div><button className="btn ghost" onClick={close} data-testid="merge-cancel">Cancel</button></div>
          </>
        ) : (
          <>
            <p data-testid="merge-summary">Merge <b>{v.name}</b> ({v.address.city}) into <b>{into.name}</b> ({into.address.city})? Every band&apos;s shows, pitches and notes at {v.name} will move to {into.name}, and {v.name} will be archived. You can undo it from History.</p>
            <ErrorBox error={error} />
            <div className="flex flex-wrap gap-2">
              <button className="btn acc" disabled={busy} onClick={merge} data-testid="merge-confirm">Merge</button>
              <button className="btn ghost" onClick={() => { setInto(null); setError(null); }} data-testid="merge-back">Back</button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}

/** Opened by Booked by's plus: picking a promoter links it and closes; leaving it (or Escape) closes it unchanged. */
function PromoterPicker({ venueId, current, all, call, onClose }: { venueId: string; current: string[]; all: { id: string; name: string; venueIds: string[] }[]; call: (n: string, i: unknown) => Promise<unknown>; onClose(): void }) {
  const linked = new Set([...current, ...all.filter((p) => p.venueIds.includes(venueId)).map((p) => p.id)]);
  const options = all.filter((p) => !linked.has(p.id));
  if (!options.length) return null;
  return (
    <select className="select !w-auto" value="" autoFocus aria-label="Link a promoter" data-testid="promoter-link" onBlur={onClose}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
      onChange={(e) => { if (!e.target.value) return; void call("venues.update", { id: venueId, patch: { promoterIds: [...linked, e.target.value] } }); onClose(); }}>
      <option value="">Booked by a promoter…</option>
      {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

const XIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
);
