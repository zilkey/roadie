"use client";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageTitle, ErrorBox, useCommand } from "@/components/ui";
import { useNotFound } from "@/components/booking/common";
import { useProfile } from "@/lib/auth";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { fmtLongYear, showName, showCity, showAddress } from "@/lib/shows";
import { billingName, configName, nameOf, ShowStatusPill, Times, useBand, type ShowRow } from "@/components/shows/common";
import { ChecklistPanel, DealPanel, DocsPanel, GearPanel, ListingsPanel, SetlistPanel } from "@/components/shows/ShowParts";
import { AskWhoIsFree, WhosFree } from "@/components/shows/Availability";
import { ShowForm, showPatch, type ShowFormState } from "@/components/shows/ShowForm";
import { Menu, type MenuItem } from "@/components/Menu";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosave } from "@/lib/autosave";
import type { Contact, Edition, Show, Venue } from "@/schema";

export default function ShowPage() {
  const { id } = useParams<{ id: string }>();
  const { doc: show, loading } = useDoc<Show>("shows", id);
  const nf = useNotFound(loading, show, "show");
  if (nf || !show) return nf;
  return <ShowView show={show} />;
}

function formOf(s: ShowRow): ShowFormState {
  const t = s.times;
  return {
    where: s.venue || !s.place ? "venue" : "house", venueId: s.venue?.id ?? "", hostContactIds: s.hostContactIds ?? [],
    city: s.place?.city ?? "", address: s.place?.address ?? "", editionId: s.editionId ?? "", date: s.date, status: s.status, loadIn: t.loadIn ?? "", soundcheck: t.soundcheck ?? "", doors: t.doors ?? "", set: t.set ?? "", setLength: t.setLength != null ? String(t.setLength) : "",
    billedAs: s.billedAs ?? "", personnel: s.personnel, soundProvider: s.sound.provider, soundNotes: s.sound.notes ?? "",
    poster: s.needs.poster, backline: s.needs.backline, merch: s.needs.merch, calendar: false, public: s.public, ticketUrl: s.ticketUrl ?? "", bandNotes: s.bandNotes ?? "",
    dealType: "guarantee", guarantee: "", doorSplitPct: "", ticketPrice: "",
  };
}

function ShowView({ show }: { show: ShowRow }) {
  const p = useProfile();
  const admin = p.role === "admin";
  const router = useRouter();
  const b = useBand();
  const { call, error, busy } = useCommand();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ShowFormState>(() => formOf(show));
  // Existing record = autosave: no Save button, each field is a patch through shows.update, "Saved" + Undo toast after.
  const as = useAutosave({ command: "shows.update", id: show.id, rev: show.rev, title: `${showName(show)} · ${show.date}`, onUseTheirs: () => setForm(formOf(show)) });
  const edit = (next: ShowFormState) => { as.patch(showPatch(form, next)); setForm(next); };
  const venues = useCollection<Venue>("venues", { skip: !admin }).rows ?? [];
  const contacts = useCollection<Contact>("contacts", { skip: !admin || !editing }).rows ?? [];
  const editions = useCollection<Edition>("editions", { skip: !admin || !editing }).rows ?? [];
  const cfg = configName(b.artist, show.billedAs);
  const playing = !!p.musicianId && show.personnel.includes(p.musicianId);

  const city = showCity(show);
  const moreItems: MenuItem[] = [
    ...(show.status !== "canceled" ? [{ key: "cancel", label: "Cancel show", danger: true, disabled: busy, onSelect: () => { if (confirm("Cancel this show? It comes off the calendar and Bandsintown.")) void call("shows.cancel", { id: show.id }); } }] : []),
    { key: "remove", label: "Archive show", danger: true, onSelect: async () => { if (confirm("Archive this show?") && (await call("shows.remove", { id: show.id }))) router.replace("/shows"); } },
  ];

  return (
    <div className="grid gap-5" data-testid="show-page" data-show-id={show.id}>
      <PageTitle
        back={<Link href="/shows" className="back-link" data-testid="back">← All shows</Link>}
        title={showName(show)}
        pill={<ShowStatusPill status={show.status} />}
        sub={[fmtLongYear(show.date), city].filter(Boolean).join(" · ")}
        actions={<>
          {show.editionName && (admin && show.editionId
            ? <Link href={`/booking/editions/${show.editionId}`} className="chip m" data-testid="show-edition-link">{show.editionName}</Link>
            : <span className="chip m">{show.editionName}</span>)}
          {!admin && p.musicianId && <span className={`chip ${playing ? "m" : ""}`}>{playing ? "You're playing" : "Not playing"}</span>}
          {admin && <SaveStatus {...as.statusProps} />}
          {admin && show.status === "canceled" && <button className="btn ghost sm" disabled={busy} onClick={() => call("shows.update", { id: show.id, patch: { status: "hold" } })} data-testid="show-restore">Bring back as a hold</button>}
          {admin && <button className="btn ghost" onClick={() => { void as.flush(); setForm(formOf(show)); setEditing(!editing); }} data-testid="show-edit">{editing ? "Done" : "Edit"}</button>}
          {admin && <Menu label="More actions" testid="show" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={moreItems} />}
        </>} />
      <ErrorBox error={error} />

      {editing && admin ? (
        <ShowForm mode="edit" value={form} onChange={edit} onBlur={() => void as.flush()} venues={venues} contacts={contacts} editions={editions} artist={b.artist} musicians={b.musicians} error={null} busy={busy} />
      ) : (
        <div className="cols">
          <div className="col-main">
            <div className="card" data-testid="show-info">
              {show.venue
                ? <Link href={`/booking/venues/${show.venue.id}`} className="font-bold underline" data-testid="show-venue-link">{showName(show)}</Link>
                : <b>{showName(show)}</b>}
              {showAddress(show) ? <span className="font-mono text-sm" data-testid="show-address">{showAddress(show)}</span> : city && <span className="font-mono text-sm">{city}</span>}
              <Times times={show.times} />
            </div>
            <div className="card gap-1">
              <span className="lbl">Billed as</span>
              <span data-testid="show-billed">{show.billedAs ? `${billingName(b.artist, show.billedAs)} · ${cfg}` : "Not set yet"}</span>
              <span className="lbl mt-2">Who&apos;s playing</span>
              <span data-testid="show-people">{show.personnel.map((id) => nameOf(b.musicians, id)).join(", ") || "No one yet"}</span>
              <span className="lbl mt-2">Sound</span>
              <span data-testid="show-sound">{show.sound.provider === "venueProvided" ? "Venue provides" : "We bring it"}{show.sound.notes ? ` · ${show.sound.notes}` : ""}</span>
              {(show.needs.poster || show.needs.backline || show.needs.merch) && <>
                <span className="lbl mt-2">We need</span>
                <span>{[show.needs.poster && "Posters", show.needs.backline && "Backline", show.needs.merch && "Merch table"].filter(Boolean).join(", ")}</span>
              </>}
            </div>
            <GearPanel show={show} musicians={b.musicians} editable={admin} />
            <SetlistPanel show={show} setlists={b.setlists} editable={admin} />
          </div>
          <div className="col-side">
            <ChecklistPanel show={show} musicians={b.musicians} editable={admin} />
            <DocsPanel show={show} editable={admin} />
            <div className="card gap-1" data-testid="band-notes">
              <span className="lbl">Band notes</span>
              {admin
                ? <textarea className="input" rows={3} placeholder="Parking, dress, food" data-testid="notes-input" {...as.bind("bandNotes", show.bandNotes ?? "", { toPatch: (t) => t.trim() || null })} />
                : <span className="whitespace-pre-wrap">{show.bandNotes || <span className="s">Nothing yet.</span>}</span>}
            </div>
            <ListingsPanel show={show} editable={admin} />
            {admin && (
              <>
                <WhosFree showId={show.id} musicians={b.musicians} extraIds={show.personnel} />
                <AskWhoIsFree showId={show.id} date={show.date} defaultIds={show.personnel} place={showName(show)} musicians={b.musicians} />
                <DealPanel show={show} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
