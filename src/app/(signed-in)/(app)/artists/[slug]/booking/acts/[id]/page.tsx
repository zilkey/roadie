"use client";
/**
 * An act's page (issue #77, board "DetailAct" on the booking canvas). About and Where they've played are shared with every band
 * (acts/{id} and venue calendars); Our take and Contacts are this band's (actNotes). Look up (#78) fills About from Spotify and the web (and asks "same band?"
 * when Spotify has several of that name, next to what the web found and the show posters); the about fields are click-to-edit once
 * anything is in them. Search Google is always there, and each show in Where they've played links to the venue's event page.
 */
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, useCommand } from "@/components/ui";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { BackLink, ContactsPanel, hrefFor, useBooking, useNotFound } from "@/components/booking/common";
import { CardGroup, DetailCard, DetailPage, KV } from "@/components/booking/DetailCards";
import { AddContactDialog } from "@/components/booking/AddContactDialog";
import { InlineValue, PlusButton } from "@/components/InlineValue";
import { ActThumb, StarIcon } from "@/components/booking/ActsTab";
import { EventPoster } from "@/components/booking/VenueEventBits";
import { actSearchUrl, actStats, type EvLike } from "@/lib/acts";
import { fmtEventDay, fmtEventYear } from "@/lib/venueEvents";
import { dateInBandZone, fmtInstant } from "@/lib/timezone";
import { ACT_RELATIONSHIPS, ARTIST_LINKS, RELATIONSHIP_HINT, RELATIONSHIP_LABEL, type ActDoc, type ActNote, type ActRelationship, type ArtistLinkKey, type Show, type VenueEvent } from "@/schema";

export default function Page() { return <AdminOnly><ActPage /></AdminOnly>; }

const LINK_LABEL = Object.fromEntries(ARTIST_LINKS) as Record<ArtistLinkKey, string>;
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function ActPage() {
  const { id } = useParams<{ id: string }>();
  const { artistId } = useArtist();
  const { doc: act, loading } = useDoc<ActDoc>("acts", id);
  const notes = useCollection<ActNote>("actNotes", { where: [["artistId", "==", artistId], ["actId", "==", id]] });
  const events = useCollection<VenueEvent>("venueEvents", { where: [["actIds", "array-contains", id]], includeDeleted: true });
  const shows = useCollection<Show>("shows");
  const b = useBooking();
  const { call, error, busy } = useCommand();
  const [addingContact, setAddingContact] = useState(false);

  const venues = useMemo(() => new Map(b.venues.map((v) => [v.id, v])), [b.venues]);
  // Rooms on our list: the ones the band has notes, a pitch or a show at (Booking's "ours").
  const ours = useMemo(() => {
    const s = new Set<string>();
    for (const [vid, n] of b.venueNotes) if (!n.deletedAt) s.add(vid);
    for (const p of b.pitches) if (p.target.kind === "venue") s.add(p.target.id);
    for (const x of shows.rows ?? []) if (x.venue) s.add(x.venue.id);
    return s;
  }, [b.venueNotes, b.pitches, shows.rows]);
  const today = dateInBandZone();
  const played = useMemo(() => (events.rows ?? []).filter((e) => e.status !== "gone").sort((x, y) => y.date.localeCompare(x.date)), [events.rows]);
  const stats = useMemo(() => actStats((events.rows ?? []) as unknown as EvLike[], venues, ours, today).get(id), [events.rows, venues, ours, today, id]);

  const nf = useNotFound(loading, act, "act");
  if (nf || !act) return nf;
  const take = notes.rows?.[0];
  const on = !!take?.shortlist;
  const rel = take?.relationship as ActRelationship | undefined;
  const contactIds = take?.contactIds ?? [];

  const update = async (patch: Record<string, unknown>) => !!(await call("acts.update", { id, patch }));
  const setRel = (r: ActRelationship) => void call("acts.note", { id, relationship: rel === r ? null : r });
  const saveNote = async (next: string) => !!(await call("acts.note", { id, note: next }));

  const opened = stats?.openedAt.length ?? 0;
  const next = stats?.next;
  const reachable = contactIds.some((cid) => b.contacts.find((c) => c.id === cid)?.emails.length);
  const social = act.links?.instagram ? { url: act.links.instagram, where: "Instagram" } : act.links?.website ? { url: act.links.website, where: "their website" } : null;
  const lonely = played.filter((e) => e.date >= today && e.acts.length === 1 && e.acts[0].actId === id);

  return (
    <DetailPage testid="act-page" back={<BackLink mode="back" href="/booking/acts" label="All acts" />}
      title={<span className="flex items-center gap-4"><ActThumb src={act.imageUrl} size={72} /><span>{act.name}</span></span>}
      meta={(opened > 0 || next) && (
        <span className="flex flex-wrap items-center gap-1.5">
          {opened > 0 && <span className="chip a" data-testid="act-opened-chip">Opened at {opened} room{opened === 1 ? "" : "s"} we play</span>}
          {next && <span className="chip" data-testid="act-next-chip">{next.role === "headliner" ? "Headlining" : "Opening at"} {next.name} {shortDay(next.date)}</span>}
        </span>
      )}
      more={<>
        <button type="button" className={on ? "btn soft" : "btn"} aria-pressed={on} data-on={on ? "1" : "0"} disabled={busy} onClick={() => void call("acts.shortlist", { id, on: !on })} data-testid="act-shortlist">
          <StarIcon on={on} size={16} />{on ? "Shortlisted" : "Shortlist"}
        </button>
        {reachable
          ? <Link href={`/booking/email/new?target=act:${id}`} className="btn acc" data-testid="act-pitch">Pitch them</Link>
          : social
            ? <a href={social.url} target="_blank" rel="noreferrer" className="btn acc" title={`No contact with an email yet: message them on ${social.where}`} data-testid="act-pitch">Pitch them ↗</a>
            : <button type="button" className="btn acc" disabled title="Add a contact or a link first" data-testid="act-pitch">Pitch them</button>}
      </>}>
      <ErrorBox error={error} />
      <CardGroup kind="shared">
        <About id={id} act={act} error={error} update={update}
          rooms={[...new Set(played.map((e) => venues.get(e.venueId)?.name).filter((n): n is string => !!n))]}
          cities={played.map((e) => venues.get(e.venueId)?.address.city).filter((c): c is string => !!c)}
          posters={played.filter((e) => e.imageUrl).slice(0, 3).map((e) => ({ id: e.id, src: e.imageUrl!, url: e.ticketUrl, label: `${venues.get(e.venueId)?.name ?? "The"} show, ${shortDay(e.date)}` }))} />
        <DetailCard title="Where they've played" testid="act-played" headerExtra={<span className="s">From venue calendars</span>}>
          {!events.rows ? <span className="s">Loading…</span>
            : played.length === 0 ? <div className="empty"><span>Not on any venue calendar in Roadie.</span></div>
            : (
              <div className="grid">
                {played.map((e) => {
                  const me = e.acts.find((a) => a.actId === id);
                  const others = e.acts.filter((a) => a.actId !== id).map((a) => a.name);
                  const v = venues.get(e.venueId);
                  return (
                    <div key={e.id} className="d-row grid grid-cols-[48px_110px_minmax(0,1fr)_auto] items-center gap-3 max-sm:grid-cols-[48px_minmax(0,1fr)_auto]" data-testid={`act-played-${e.id}`}>
                      {e.ticketUrl
                        ? <a href={e.ticketUrl} target="_blank" rel="noreferrer" aria-label={`${e.title}: the event page`}><EventPoster src={e.imageUrl} alt="" size={48} testid="played-poster" /></a>
                        : <EventPoster src={e.imageUrl} alt="" size={48} testid="played-poster" />}
                      <b className="whitespace-nowrap max-sm:hidden">{e.date >= today ? fmtEventDay(e.date) : fmtEventYear(e.date)}</b>
                      <span className="min-w-0">
                        <b className="sm:hidden">{e.date >= today ? fmtEventDay(e.date) : fmtEventYear(e.date)} · </b>
                        {v ? <Link href={`${hrefFor("venue", v.id)}?tab=events`}>{v.name}</Link> : "A venue"}
                        <span className="s">{v?.address.city ? ` · ${v.address.city}` : ""}{others.length ? ` · with ${others.join(", ")}` : ""}</span>
                        {e.ticketUrl && <> <a className="s whitespace-nowrap" href={e.ticketUrl} target="_blank" rel="noreferrer" data-testid={`played-link-${e.id}`}>Event page ↗</a></>}
                      </span>
                      {me?.role === "support" ? <span className="chip">Opening</span> : <span className="chip dk">Headlining</span>}
                    </div>
                  );
                })}
              </div>
            )}
          <span className="s">Only rooms in Roadie with a calendar it can read.{lonely.length > 0 && ` The ${[...new Set(lonely.map((e) => venues.get(e.venueId)?.name ?? "venue"))].join(" and ")} headline${lonely.length === 1 ? " has" : "s have"} no support listed yet.`}</span>
        </DetailCard>
      </CardGroup>

      <CardGroup kind="private">
        <DetailCard private title="Our take" testid="act-take">
          <div className="grid gap-2">
            <span className="d-k">What are they to us?</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="What are they to us">
              {ACT_RELATIONSHIPS.map((r) => (
                <button key={r} type="button" className="pick" aria-pressed={rel === r} disabled={busy} onClick={() => setRel(r)} data-testid={`act-rel-${r}`}>{RELATIONSHIP_LABEL[r]}</button>
              ))}
            </div>
            <span className="s" data-testid="act-rel-hint">{rel ? RELATIONSHIP_HINT[rel] : "Pick one, or leave it blank."}</span>
          </div>
          <KV rows={[["Note", <InlineValue key="note" testid="act-note" label="Note" kind="textarea" value={take?.note ?? ""} emptyLabel="Add a note…" canEdit error={error} onSave={saveNote} />]]} />
        </DetailCard>

        <DetailCard private title="Contacts" testid="act-contacts" headerExtra={<PlusButton label="Add a contact" testid="contact-add" onClick={() => setAddingContact(true)} />}>
          {contactIds.length === 0
            ? <div className="empty"><span>No one yet. Add their booker, manager or a member: they&apos;re your contacts, linked to this act.</span></div>
            : <ContactsPanel kind="acts" parentId={id} contactIds={contactIds} contacts={b.contacts} />}
        </DetailCard>
        <AddContactDialog kind="acts" parentId={id} parentName={act.name} linkedIds={contactIds} open={addingContact} onClose={() => setAddingContact(false)} onWantOpen={() => setAddingContact(true)} />
      </CardGroup>
    </DetailPage>
  );
}

/** A show poster from a venue calendar, for "same band?": the poster often shows the band. */
interface Poster { id: string; src: string; url?: string; label: string }

/**
 * About: what Look up (#78) finds, each value click-to-edit. Nothing yet: the empty box with Look up. When Spotify has several
 * artists by the name, the "same band?" question sits under what the web found, with the show posters to compare against.
 */
function About({ id, act, error, update, rooms, cities, posters }: {
  id: string; act: ActDoc; error: string | null; update(patch: Record<string, unknown>): Promise<boolean>; rooms: string[]; cities: string[]; posters: Poster[];
}) {
  const lookup = useCommand();
  const run = (spotifyId?: string | null) => void lookup.call("acts.lookup", { id, ...(spotifyId !== undefined ? { spotifyId } : {}) });
  const [addingGenre, setAddingGenre] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const genres = act.genres ?? [];
  const links = Object.entries(act.links ?? {}).filter(([, v]) => v) as [ArtistLinkKey, string][];
  const empty = !act.description && !act.hometown && !genres.length && !links.length;
  const cands = act.lookupCandidates ?? [];
  const lookBtn = (label: string, cls: string) => (
    <button type="button" className={`btn ${cls} sm`} disabled={lookup.busy} onClick={() => run()} data-testid="act-lookup">{lookup.busy ? "Looking up…" : label}</button>
  );
  const google = (
    <a className="btn ghost sm" href={actSearchUrl(act.name, cities)} target="_blank" rel="noreferrer" data-testid="act-google">Search Google ↗</a>
  );
  const lookErr = <ErrorBox error={lookup.error} />;

  const the = rooms.map((r) => `the ${r}`);
  const where = the.length ? `Which one played ${the.length > 1 ? `${the.slice(0, -1).join(", ")} and ${the[the.length - 1]}` : the[0]}?` : "Which one is it?";
  const picker = cands.length > 0 && (
    <div className="grid gap-3 rounded-xl border border-[var(--divider)] p-3" data-testid="act-same-band">
      <span>More than one band goes by this name. {where}</span>
      <span className="s">Spotify has {cands.length} artists called {act.name}. Compare their pictures with {empty ? "" : "what the web found above and "}{posters.length ? "the show poster" : "a Google search"}, or open one to hear it.</span>
      {posters.length > 0 && (
        <span className="flex flex-wrap gap-2" data-testid="act-posters">
          {posters.map((p) => p.url
            ? <a key={p.id} href={p.url} target="_blank" rel="noreferrer" title={`${p.label}: the event page`}><EventPoster src={p.src} alt={p.label} size={120} testid="act-poster" /></a>
            : <EventPoster key={p.id} src={p.src} alt={p.label} size={120} testid="act-poster" />)}
        </span>
      )}
      {cands.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-3" data-testid={`act-cand-${c.id}`}>
          <ActThumb src={c.imageUrl} size={56} />
          <span className="min-w-0 flex-1">
            <b>{c.name}</b>
            <span className="s block">{c.genres?.length ? <>{c.genres.join(" · ")} · </> : null}<a href={c.url} target="_blank" rel="noreferrer">Listen on Spotify ↗</a></span>
          </span>
          <button type="button" className="btn acc sm" disabled={lookup.busy} onClick={() => run(c.id)} data-testid={`act-cand-pick-${c.id}`}>This one</button>
        </div>
      ))}
      <span><button type="button" className="btn ghost sm" disabled={lookup.busy} onClick={() => run(null)} data-testid="act-cand-none">None of these</button></span>
    </div>
  );

  if (empty) {
    return (
      <DetailCard title="About" testid="act-about" headerExtra={google}>
        {picker || (
          <div className="empty grid justify-items-start gap-2.5" data-testid="act-about-empty">
            <span>Nothing about this act yet. Look up searches the web for their links, photo, where they&apos;re from and what they sound like. You can fix anything it gets wrong.</span>
            {act.lookedUpAt && <span data-testid="act-lookup-nothing">Look up found nothing for {act.name}. Try Search Google, and add what you know by hand.</span>}
            {lookBtn(`Look up ${act.name}`, "acc")}
          </div>
        )}
        {lookErr}
      </DetailCard>
    );
  }
  const setGenres = (next: string[]) => update({ genres: next.length ? next : null });
  return (
    <DetailCard title="About" testid="act-about" headerExtra={<span className="flex flex-wrap items-center gap-2">{google}{lookBtn(act.lookedUpAt ? "Look up again" : "Look up", "soft")}</span>}>
      {lookErr}
      <KV rows={[
        ["Sounds like", <InlineValue key="d" testid="act-description" label="Sounds like" kind="textarea" value={act.description ?? ""} canEdit error={error} onSave={(v) => update({ description: v.trim() || null })} />],
        ["Genres", (
          <span key="g" className="flex flex-wrap items-center gap-1.5" data-testid="act-genres">
            {genres.map((g) => (
              <span key={g} className="chip w lg">{g}<button type="button" aria-label={`Remove ${g}`} onClick={() => void setGenres(genres.filter((x) => x !== g))}>×</button></span>
            ))}
            {addingGenre
              ? <InlineValue testid="act-genre-new" label="New genre" kind="text" value="" autoStart canEdit error={error}
                  onSave={async (v) => { setAddingGenre(false); const g = v.trim(); return !g || genres.includes(g) ? true : setGenres([...genres, g]); }} />
              : <PlusButton label="Add a genre" testid="act-genre-add" onClick={() => setAddingGenre(true)} />}
          </span>
        )],
        ["From", <InlineValue key="h" testid="act-hometown" label="From" kind="text" value={act.hometown ?? ""} canEdit error={error} onSave={(v) => update({ hometown: v.trim() || null })} />],
        ["Links", (
          <span key="l" className="grid gap-2" data-testid="act-links">
            <span className="flex flex-wrap items-center gap-2">
              {links.map(([k, url]) => <a key={k} className="chip w" href={url} target="_blank" rel="noreferrer">{LINK_LABEL[k]} ↗</a>)}
              {!addingLink && <PlusButton label="Add a link" testid="act-link-add" onClick={() => setAddingLink(true)} />}
            </span>
            {addingLink && <AddLink have={act.links ?? {}} onCancel={() => setAddingLink(false)} onSave={async (links) => { const ok = await update({ links }); if (ok) setAddingLink(false); return ok; }} />}
          </span>
        )],
      ]} />
      {picker}
      <span className="s">{act.lookedUpAt ? `Looked up ${fmtInstant(Date.parse(act.lookedUpAt), { month: "short", day: "numeric" })}${act.sources?.length ? ` from ${act.sources.length} web source${act.sources.length === 1 ? "" : "s"}` : ""}. ` : ""}Click anything to fix it.</span>
    </DetailCard>
  );
}

/** Pick which link and paste it: Website, Instagram, Spotify, Bandcamp… (the band's own link kinds). An empty URL removes that link. */
function AddLink({ have, onSave, onCancel }: { have: Partial<Record<ArtistLinkKey, string>>; onSave(links: Partial<Record<ArtistLinkKey, string>>): Promise<boolean>; onCancel(): void }) {
  const [kind, setKind] = useState<ArtistLinkKey>(ARTIST_LINKS.find(([k]) => !have[k])?.[0] ?? "website");
  const [url, setUrl] = useState(have[kind] ?? "");
  const save = () => {
    const next = { ...have };
    if (url.trim()) next[kind] = url.trim(); else delete next[kind];
    void onSave(next);
  };
  return (
    <span className="flex flex-wrap items-center gap-2" data-testid="act-link-form">
      <select className="select !w-auto" value={kind} aria-label="Which link" onChange={(e) => { const k = e.target.value as ArtistLinkKey; setKind(k); setUrl(have[k] ?? ""); }}>
        {ARTIST_LINKS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <input className="input !w-[260px]" type="url" placeholder="https://…" aria-label="Link" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} data-testid="act-link-url" />
      <button type="button" className="btn acc sm" onClick={save} data-testid="act-link-save">Save</button>
      <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
    </span>
  );
}
