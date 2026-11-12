"use client";
import { Crumbs, campaignCrumb, campaignsCrumb, sectionCrumb } from "@/components/booking/BookingNav";
import { PitchBody } from "@/components/booking/PitchBody";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { CardGroup, DetailCard, DetailPage, KV, PitchedPill, VENUE_SHARED_WARN, useSingleEdit } from "@/components/booking/DetailCards";
import { PitchSummaryCard, usePlaceThreads } from "@/components/booking/PitchSummaryCard";
import { AddContactDialog } from "@/components/booking/AddContactDialog";
import { InlineValue, PlusButton } from "@/components/InlineValue";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import {
  BackLink, ContactsPanel, EntityForm, Flagged, StatusChip, StatusPill, Tabs, hrefFor, roomForm, useBooking, useNotFound, type VenueRow,
} from "@/components/booking/common";
import { fmtDate, isActive } from "@/lib/booking";
import { privateOf } from "@/lib/venues";
import { useVenueTypes, venueTypeLabel } from "@/lib/venueTypes";
import { VenueEventsTab } from "@/components/booking/VenueEventsTab";
import { WhoWeKnowCard } from "@/components/booking/WhoWeKnow";
import type { Show, Venue } from "@/schema";

type Tab = "pitch" | "details" | "events";

const ROOM_KEYS = ["name", "street", "city", "state", "zip", "type", "capacity", "website"];
const roomFields = ROOM_KEYS.map((k) => roomForm.fields.find((f) => f.key === k)!);
const href = (u: string) => (u.startsWith("http") ? u : `https://${u}`);

/**
 * One page per venue (#82, Jeff 2026-11-12: "they always confuse me"): tabs Pitch | Venue details | Venue events, one header for
 * all three (the venue's name, the pitch's status, Booked it and More) and the trail Booking › <the pitch's campaign> › <venue>.
 * /booking/venues/{id} and a venue's /booking/pitches/{id} both render it; the route only picks the tab it opens on (?tab= too).
 * The Pitch tab is the pitch page's content (PitchBody): the pitch the route names, else the band's active pitch on the venue, else
 * "Start a pitch". Members see Venue details and Venue events only.
 *
 * Venue details: the venue is two documents shown as a single column of cards. "About the room" is shared with every band (autosaved; the card warns
 * who sees it). The private group (admins only) is this band's pitch, contacts, notes, promoters and shows. Everything autosaves; Done closes a card.
 */
export function VenueWorkspace(props: { venueId: string; pitchId?: string; defaultTab: Tab }) { return <Suspense><VenueView {...props} /></Suspense>; }

function VenueView({ venueId: id, pitchId, defaultTab }: { venueId: string; pitchId?: string; defaultTab: Tab }) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { role, artistId } = useArtist();
  const admin = role === "admin";
  const asked = sp.get("tab") as Tab | null;
  const tab: Tab = asked && ["pitch", "details", "events"].includes(asked) && (admin || asked !== "pitch") ? asked : !admin && defaultTab === "pitch" ? "details" : defaultTab;
  const [booking, setBooking] = useState(false);
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
  // The Pitch tab's pitch: the one the route names, else this band's active pitch here.
  const pitch = pitches.find((p) => p.id === pitchId) ?? pitches.find((p) => p.artistId === artistId && isActive(p.status));
  const past = pitches.filter((p) => p.artistId === artistId && p.id !== pitch?.id).sort((a, c) => (c.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  const campaign = pitch?.campaignId ? b.campaigns.find((c) => c.id === pitch.campaignId) : undefined;
  const ourShows = [...(shows.rows ?? [])].sort((a, c) => c.date.localeCompare(a.date));
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
    <DetailPage testid="venue-page" recordId={id}
      back={<Crumbs items={[...(admin && pitch ? [campaignsCrumb, campaignCrumb(campaign, isActive(pitch.status))] : [sectionCrumb("venue")]), { label: v.name }]} back={<BackLink mode="back" href={admin ? "/booking/venues" : "/shows"} label={admin ? "All venues" : "Shows"} />} />}
      title={v.name}
      pill={admin && pitch ? <StatusPill status={pitch.status} /> : admin && pitched ? <PitchedPill /> : undefined}
      meta={[typeLabel, v.address.city].filter(Boolean).join(" · ")}
      more={admin ? (
        <div className="flex items-center gap-2">
          {pitch && tab === "pitch" && pitch.status !== "declined" && pitch.status !== "dropped" && <button type="button" className="btn acc" onClick={() => setBooking(true)} data-testid="booked-it">Booked it</button>}
          {(!archived || pitch) && <Menu label="More actions" testid="venue" trigger={<span className="px-1 text-lg font-bold leading-none" aria-hidden>⋮</span>} items={[
            ...(pitch && isActive(pitch.status) ? [{ key: "remove", testid: "pitch-menu-remove", label: "Remove from Pitch List", danger: true,
              onSelect: async () => { if (confirm("Take this off the Pitch List?") && (await call("pitches.remove", { id: pitch.id }))) router.replace(campaignCrumb(campaign).href!); } }] : []),
            // Abandon moved up from the bottom of the Pitch tab (Jeff, 2026-11-12); same confirm.
            ...(pitch && pitch.status !== "dropped" ? [{ key: "abandon", testid: "pitch-abandon", label: "Abandon pitch", danger: true,
              onSelect: () => { if (confirm("Abandon this pitch? It moves to Past pitches.")) void call("pitches.move", { id: pitch.id, status: "dropped" }); } }] : []),
            ...(!archived ? [
              { key: "merge", label: "Merge into another venue…", onSelect: () => setMerging(true) },
              { key: "archive", label: "Archive venue", danger: true, onSelect: archiveVenue },
            ] : []),
          ]} />}
        </div>
      ) : undefined}>
      <Tabs<Tab> testid="venue-tab" value={tab} onChange={(t) => router.replace(`${pathname}${t === defaultTab ? "" : `?tab=${t}`}`)}
        options={[...(admin ? [["pitch", "Pitch"] as [Tab, string]] : []), ["details", "Venue details"], ["events", "Venue events"]]} />
      <ErrorBox error={error} />
      {tab === "pitch" && (pitch ? <PitchBody key={pitch.id} id={pitch.id} embedded booking={booking} setBooking={setBooking} /> : (
        <section className="card" data-testid="venue-no-pitch">
          <div className="card-head"><h2>No pitch here yet</h2></div>
          <span className="s">Start one to track lineup, dates, emails and the conversation with {v.name}.</span>
          <Flagged kind="venue" id={id} pitches={b.pitches} label="Start a pitch">{(button, form) => <div className="grid justify-items-start gap-2">{button}{form}</div>}</Flagged>
        </section>
      ))}
      {tab === "pitch" && past.length > 0 && (
        <section className="card" data-testid="venue-past-pitches">
          <div className="card-head"><h2>{pitch ? "Other pitches here" : "Past pitches here"}</h2></div>
          {past.map((p) => <Link key={p.id} href={`/booking/pitches/${p.id}`} className="flex flex-wrap items-center gap-2" data-testid={`venue-past-pitch-${p.id}`}><StatusChip status={p.status} /><span className="s">{p.createdAt ? new Date(p.createdAt.toMillis()).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : ""}</span></Link>)}
        </section>
      )}
      {tab === "events" && <VenueEventsTab venue={v} admin={admin} />}
      {tab === "details" && <>
      {archived && (
        <div className="card hi" data-testid="venue-archived">
          <span>You archived this venue for your band. Other bands still see it.</span>
          <div><button className="btn ghost sm" data-testid="venue-unarchive"
            onClick={() => call("venues.create", { name: v.name, type: v.type, address: v.address, region: v.region })}>Bring it back to our lists</button></div>
        </div>
      )}
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
          <WhoWeKnowCard b={b} venue={{ id, ...mine }} />
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
          <DetailCard private title={`Our shows here (${ourShows.length})`}>
            {ourShows.length === 0 ? <div className="empty" data-testid="no-shows">None yet. Shows appear here once you book one.</div> : (
              <div className="grid gap-2" data-testid="venue-shows">
                {ourShows.map((s) => (
                  <Link key={s.id} href={`/shows/${s.id}`} data-testid={`venue-show-${s.id}`} className="flex flex-wrap items-baseline gap-x-3"><b>{fmtDate(s.date)} {s.date.slice(0, 4)}</b><span className="s">{s.status}{s.editionName ? ` · ${s.editionName}` : ""}</span></Link>
                ))}
              </div>
            )}
          </DetailCard>
        </CardGroup>
      )}
      </>}
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
