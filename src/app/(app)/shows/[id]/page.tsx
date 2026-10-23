"use client";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PageTitle, ErrorBox, useCommand } from "@/components/ui";
import { BackLink, useNotFound } from "@/components/booking/common";
import { useProfile } from "@/lib/auth";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { fmtLongYear } from "@/lib/shows";
import { billingName, configName, nameOf, ShowStatusChip, Times, useBand, type ShowRow } from "@/components/shows/common";
import { ChecklistPanel, DealPanel, DocsPanel, GearPanel, ListingsPanel, SetlistPanel } from "@/components/shows/ShowParts";
import { AskWhoIsFree, WhosFree } from "@/components/shows/Availability";
import { ShowForm, timesOf, type ShowFormState } from "@/components/shows/ShowForm";
import type { Show, Venue } from "@/schema";

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
    venueId: s.venue.id, date: s.date, status: s.status, loadIn: t.loadIn ?? "", soundcheck: t.soundcheck ?? "", doors: t.doors ?? "", set: t.set ?? "", setLength: t.setLength != null ? String(t.setLength) : "",
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
  const venues = useCollection<Venue>("venues", { skip: !admin }).rows ?? [];
  const [notes, setNotes] = useState<string | null>(null);
  const cfg = configName(b.artist, show.billedAs);
  const playing = !!p.musicianId && show.personnel.includes(p.musicianId);

  async function save() {
    const f = form, patch: Record<string, unknown> = {};
    if (f.venueId !== show.venue.id) patch.venueId = f.venueId;
    if (f.date !== show.date) patch.date = f.date;
    if (f.status !== show.status) patch.status = f.status;
    if (JSON.stringify(timesOf(f)) !== JSON.stringify(timesOf(formOf(show)))) patch.times = timesOf(f);
    if (f.billedAs !== (show.billedAs ?? "")) patch.billedAs = f.billedAs || null;
    if (JSON.stringify([...f.personnel].sort()) !== JSON.stringify([...show.personnel].sort())) patch.personnel = f.personnel;
    if (f.soundProvider !== show.sound.provider || f.soundNotes !== (show.sound.notes ?? "")) patch.sound = { provider: f.soundProvider, ...(f.soundNotes.trim() ? { notes: f.soundNotes.trim() } : {}) };
    if (f.soundProvider !== show.sound.provider) patch.rebuildGear = true;
    if (f.poster !== show.needs.poster || f.backline !== show.needs.backline || f.merch !== show.needs.merch) patch.needs = { poster: f.poster, backline: f.backline, merch: f.merch };
    if (f.public !== show.public) patch.public = f.public;
    if (f.ticketUrl !== (show.ticketUrl ?? "")) patch.ticketUrl = f.ticketUrl || null;
    if (f.bandNotes !== (show.bandNotes ?? "")) patch.bandNotes = f.bandNotes.trim() || null;
    if (!Object.keys(patch).length) return setEditing(false);
    if (await call("shows.update", { id: show.id, patch })) setEditing(false);
  }

  return (
    <div className="grid gap-3" data-testid="show-page" data-show-id={show.id}>
      <BackLink href="/shows" label="Shows" />
      <PageTitle title={show.venue.name} sub={fmtLongYear(show.date)} />
      <ErrorBox error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <ShowStatusChip status={show.status} />
        {show.editionName && <span className="chip m">{show.editionName}</span>}
        {!admin && p.musicianId && <span className={`chip ${playing ? "m" : ""}`}>{playing ? "You're playing" : "Not playing"}</span>}
        {admin && <button className="btn ghost sm" onClick={() => { setForm(formOf(show)); setEditing(!editing); }} data-testid="show-edit">{editing ? "Close" : "Edit"}</button>}
        {admin && show.status !== "canceled" && (
          <button className="btn ghost sm" disabled={busy} data-testid="show-cancel"
            onClick={() => confirm("Cancel this show? It comes off the calendar and Bandsintown.") && call("shows.cancel", { id: show.id })}>Cancel show</button>
        )}
        {admin && show.status === "canceled" && <button className="btn ghost sm" disabled={busy} onClick={() => call("shows.update", { id: show.id, patch: { status: "hold" } })} data-testid="show-restore">Bring back as a hold</button>}
      </div>

      {editing && admin ? (
        <ShowForm mode="edit" value={form} onChange={setForm} venues={venues} artist={b.artist} musicians={b.musicians} error={null} busy={busy} submitLabel="Save changes" onSubmit={save} onCancel={() => setEditing(false)} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid content-start gap-3">
            <div className="card" data-testid="show-info">
              <b>{show.venue.name}</b>
              {show.venue.address ? <span className="font-mono text-sm" data-testid="show-address">{show.venue.address}</span> : show.venue.city && <span className="font-mono text-sm">{show.venue.city}</span>}
              <Times times={show.times} />
            </div>
            <div className="grid gap-1">
              <span className="lbl">Billed as</span>
              <span data-testid="show-billed">{show.billedAs ? `${billingName(b.artist, show.billedAs)} · ${cfg}` : "Not set yet"}</span>
              <span className="lbl">Who&apos;s playing</span>
              <span data-testid="show-people">{show.personnel.map((id) => nameOf(b.musicians, id)).join(", ") || "No one yet"}</span>
              <span className="lbl">Sound</span>
              <span data-testid="show-sound">{show.sound.provider === "venueProvided" ? "Venue provides" : "We bring it"}{show.sound.notes ? ` · ${show.sound.notes}` : ""}</span>
              {(show.needs.poster || show.needs.backline || show.needs.merch) && <>
                <span className="lbl">We need</span>
                <span>{[show.needs.poster && "Posters", show.needs.backline && "Backline", show.needs.merch && "Merch table"].filter(Boolean).join(", ")}</span>
              </>}
            </div>
            <GearPanel show={show} musicians={b.musicians} editable={admin} />
            <SetlistPanel show={show} setlists={b.setlists} editable={admin} />
          </div>
          <div className="grid content-start gap-3">
            <ChecklistPanel show={show} musicians={b.musicians} editable={admin} />
            <DocsPanel show={show} editable={admin} />
            <div className="grid gap-1" data-testid="band-notes">
              <span className="lbl">Band notes</span>
              {admin
                ? <textarea className="input" rows={3} placeholder="Parking, dress, food" value={notes ?? show.bandNotes ?? ""} data-testid="notes-input"
                    onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== null && notes !== (show.bandNotes ?? "")) call("shows.update", { id: show.id, patch: { bandNotes: notes.trim() || null } }).then(() => setNotes(null)); }} />
                : <span className="whitespace-pre-wrap">{show.bandNotes || <span className="s">Nothing yet.</span>}</span>}
            </div>
            <ListingsPanel show={show} editable={admin} />
            {admin && (
              <>
                <WhosFree showId={show.id} musicians={b.musicians} extraIds={show.personnel} />
                <AskWhoIsFree showId={show.id} date={show.date} defaultIds={show.personnel} place={show.venue.name} musicians={b.musicians} />
                <DealPanel show={show} />
              </>
            )}
          </div>
        </div>
      )}
      {admin && <button className="btn ghost sm justify-self-start" onClick={async () => { if (confirm("Archive this show?") && (await call("shows.remove", { id: show.id }))) router.replace("/shows"); }} data-testid="show-remove">Archive show</button>}
    </div>
  );
}
