"use client";
import { draftPath } from "@/schema/drafts";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ErrorBox, PageTitle, PickChip, useCommand } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { todayStr } from "@/lib/booking";
import { Menu } from "@/components/Menu";
import { Missing, useMusic, type FileRow } from "@/components/music/common";
import { RecordingRow } from "@/components/music/RecordingRow";
import { NewRecordings } from "@/components/music/NewRecordings";
import { DrivePicker, type Pick } from "@/components/music/DrivePicker";
import { fmtLong, fmtTime } from "@/lib/shows";
import { SaveStatus } from "@/components/SaveStatus";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useAutosave } from "@/lib/autosave";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useDoc } from "@/lib/firestore-hooks";
import type { Rehearsal, RehearsalLocation, SetlistTemplate } from "@/schema";
import ImportSetlistDialog from "./ImportSetlistDialog";
import { ExpensesCardFor } from "@/components/money/ExpensesCard";
import { Tabs } from "@/components/booking/common";
import { DetailCard, DetailPage, KV, useSingleEdit } from "@/components/booking/DetailCards";
import { SongSearch } from "@/components/music/SongSearch";
import { InlineValue } from "@/components/InlineValue";
import { CalendarSend } from "@/components/CalendarSend";

export default function RehearsalPage() { return <Suspense><Page /></Suspense>; }

function Page() {
  const { id } = useParams<{ slug: string; id: string }>();
  const m = useMusic();
  const admin = useProfile().role === "admin";
  const r = id === "new" ? null : m.rehearsals.find((x) => x.id === id);
  if (m.loading) return null;
  if (id === "new" && !admin) return <Missing what="rehearsal" />;
  if (id !== "new" && !r) return <Missing what="rehearsal" />;
  // New = a draft with an explicit create button; existing = autosave.
  return id === "new" ? <NewRehearsal m={m} /> : <ExistingRehearsal id={id} m={m} admin={admin} />;
}

type Music = ReturnType<typeof useMusic>;
type Row = Rehearsal & { id: string };

/** Editable fields of an existing rehearsal (location is saved on its own, through rehearsals.setLocation). */
interface RehForm { date: string; startTime: string; endTime: string; notes: string; personnel: string[]; ran: Record<string, string> }

const formOf = (r: Rehearsal): RehForm => ({
  date: r.date, startTime: r.startTime ?? "", endTime: r.endTime ?? "", notes: r.notes ?? "", personnel: r.personnel,
  ran: Object.fromEntries(r.songs.map((s) => [s.songId, s.note ?? ""])),
});
const songList = (ran: Record<string, string>) => Object.entries(ran).map(([songId, note]) => ({ songId, ...(note.trim() ? { note: note.trim() } : {}) }));
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Fields only the next form state changed, as a rehearsals.update patch (null clears). */
function rehPatch(a: RehForm, b: RehForm): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (b.date !== a.date && b.date) p.date = b.date;
  if (b.startTime !== a.startTime) p.startTime = b.startTime || null;
  if (b.endTime !== a.endTime) p.endTime = b.endTime || null;
  if (b.notes !== a.notes) p.notes = b.notes.trim() || null;
  if (!sameJson(a.personnel, b.personnel)) p.personnel = b.personnel;
  if (!sameJson(a.ran, b.ran)) p.songs = songList(b.ran);
  return p;
}

const titleOf = (m: Music, sid: string) => m.songs.find((s) => s.id === sid)?.title ?? "Song";

// ---------- location ----------

interface Place { name?: string; address: string; lat: number; lng: number }
/** The shape rehearsals.setLocation and rehearsals.create take (name optional, the rest from the autocomplete). */
const placeOf = (p: Place): RehearsalLocation => ({ ...(p.name ? { name: p.name } : {}), address: p.address, lat: p.lat, lng: p.lng });

/**
 * Address / place typeahead: geo.autocomplete through the server, debounced 300 ms. Each suggestion row gets
 * reh-location-suggestion. onType fires on every keystroke, onPick when a suggestion is chosen.
 */
function LocationSearch({ initial, onType, onPick, testid = "reh-location-input" }: {
  initial: string; onType?(text: string): void; onPick(p: Place): void; testid?: string;
}) {
  const { call, error } = useCommand();
  const [text, setText] = useState(initial);
  const [hits, setHits] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const skip = useRef(false); // after a pick, the label we just wrote doesn't search again
  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const q = text.trim();
    const my = ++seq.current;
    if (q.length < 3) { setHits([]); return; }
    const t = setTimeout(async () => {
      const r = await call<{ suggestions: Place[] }>("geo.autocomplete", { q });
      if (my === seq.current) { setHits(r?.suggestions ?? []); setOpen(true); }
    }, 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(p: Place) {
    skip.current = true; seq.current++;
    setText(p.name && !p.address.startsWith(p.name) ? `${p.name}, ${p.address}` : p.address);
    setHits([]); setOpen(false);
    onPick(p);
  }
  return (
    <div className="grid gap-1">
      <input className="input" value={text} placeholder="Start typing an address or place…" autoComplete="off" aria-label="Rehearsal address" data-testid={testid}
        onChange={(e) => { setText(e.target.value); setOpen(true); onType?.(e.target.value); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && hits.length > 0 && (
        <ul role="listbox" className="grid gap-1 rounded-[10px] border p-1" style={{ background: "var(--surface)", borderColor: "var(--input-border)" }}>
          {hits.map((h, i) => (
            <li key={`${h.lat},${h.lng},${i}`} role="option" aria-selected={false} data-testid="reh-location-suggestion">
              <button type="button" className="w-full cursor-pointer rounded-md border-0 bg-transparent px-3 py-2 text-left" style={{ color: "var(--ink)", font: "inherit" }}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)}>
                {h.name && <b>{h.name}</b>}{h.name ? " " : ""}<span className="s">{h.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={error} />
    </div>
  );
}

// ---------- new rehearsal ----------

interface NewForm { date: string; location: RehearsalLocation | null; notes: string; personnel: string[]; ran: Record<string, string> }

/** New rehearsal: values are a draft (device + server); "Save rehearsal" creates it. */
function NewRehearsal({ m }: { m: Music }) {
  const router = useRouter();
  const { call, error, busy } = useCommand();
  const draft = useDraft<NewForm>(draftPath.newIn("rehearsals"), { date: todayStr(), location: null, notes: "", personnel: [], ran: {} }, {
    title: (v) => `New rehearsal · ${v.date}${v.location?.name || v.location?.address ? ` · ${v.location?.name ?? v.location?.address}` : ""}`,
  });
  const [picks, setPicks] = useState<Pick[]>([]);
  const mutationId = useRef(newMutationId());
  const v = draft.value;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await draft.settle();
    const r = await call("rehearsals.create", {
      date: v.date, ...(v.location ? { location: v.location } : {}), ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
      personnel: v.personnel, songs: songList(v.ran), files: picks,
    }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r?.id) { await draft.clear(); router.push(`/rehearsals/${r.id}`); }
  }

  return (
    <form className="grid gap-5" onSubmit={save} data-testid="rehearsal-page">
      <PageTitle back={<Link href="/rehearsals" className="back-link" data-testid="back">← All rehearsals</Link>} title="Create Rehearsal" sub="When, where, who and which songs. The songs power 'last rehearsed'." />
      {!draft.ready ? null : <div className="cols">
        <div className="col-main">
          <div className="card">
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1"><span className="lbl">When</span><input type="date" className="input" value={v.date} onChange={(e) => draft.setValue({ ...v, date: e.target.value })} required data-testid="reh-date" /></label>
              <div className="grid gap-1"><span className="lbl">Where</span>
                <LocationSearch initial={v.location?.name ?? v.location?.address ?? ""}
                  onType={(t) => draft.setValue({ ...v, location: t.trim() ? { name: t.trim() } : null })}
                  onPick={(p) => draft.setValue({ ...v, location: placeOf(p) })} />
              </div>
            </div>
            <span className="lbl">Band members</span>
            <div className="flex flex-wrap gap-1.5">
              {m.musicians.filter((x) => x.active).map((x) => (
                <PickChip key={x.id} on={v.personnel.includes(x.id)} testid={`reh-who-${x.name}`}
                  onToggle={() => draft.setValue({ ...v, personnel: v.personnel.includes(x.id) ? v.personnel.filter((i) => i !== x.id) : [...v.personnel, x.id] })}>{x.name}</PickChip>
              ))}
            </div>
            <span className="lbl">Songs</span>
            <div className="grid gap-1.5" data-testid="reh-songs">
              <SongSearch songs={m.songs} exclude={Object.keys(v.ran)} onAdd={(sid) => draft.setValue({ ...v, ran: { ...v.ran, [sid]: "" } })} />
              {Object.keys(v.ran).map((sid) => (
                <div key={sid} className="flex min-h-[44px] items-center gap-2" data-testid={`reh-song-${titleOf(m, sid)}`}>
                  <span className="flex-1 text-sm font-semibold">{titleOf(m, sid)}</span>
                  <input className="input !w-1/2" placeholder="Note" value={v.ran[sid]} onChange={(e) => draft.setValue({ ...v, ran: { ...v.ran, [sid]: e.target.value } })} aria-label={`Note for ${titleOf(m, sid)}`} data-testid={`reh-note-${titleOf(m, sid)}`} />
                  <button type="button" aria-label={`Remove ${titleOf(m, sid)}`} className="min-h-[44px] min-w-[44px] border-0 bg-transparent text-lg s"
                    onClick={() => { const { [sid]: _gone, ...rest } = v.ran; draft.setValue({ ...v, ran: rest }); }} data-testid="reh-song-remove">×</button>
                </div>
              ))}
            </div>
            <label className="grid gap-1"><span className="lbl">Notes</span><textarea className="input" rows={2} value={v.notes} onChange={(e) => draft.setValue({ ...v, notes: e.target.value })} data-testid="reh-notes" /></label>
            <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
            <div className="flex items-center gap-2">
              <button className="btn acc" disabled={busy || !v.date} data-testid="reh-save">Create Rehearsal</button>
            </div>
            <ErrorBox error={error} />
          </div>
        </div>
        <div className="col-side">
          <div className="card"><span className="lbl">Recording</span><DrivePicker defaultKind="rehearsal" onChange={setPicks} testid="picker" /></div>
        </div>
      </div>}
    </form>
  );
}

// ---------- existing rehearsal ----------

type Tab = "info" | "money";
const TABS: Tab[] = ["info", "money"];
type CardKey = "when";

/**
 * One column of cards, like the booking detail pages, with Info and Money tabs like a show. Info: When & where, Band members,
 * Songs, Notes, Recordings; Money: the expenses card. Everything autosaves; When & where's pencil opens it and Done closes it; Notes
 * edits in place (tap the text, leave it, saved). Songs has no
 * Edit: admins add from the search box and remove with ×; each song's chevron opens its notes and recordings for this rehearsal.
 */
function ExistingRehearsal({ id, m, admin }: { id: string; m: Music; admin: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const tab: Tab = TABS.includes(sp.get("tab") as Tab) ? (sp.get("tab") as Tab) : "info";
  const setTab = (t: Tab) => router.replace(`/rehearsals/${id}${t === "info" ? "" : `?tab=${t}`}`);
  const { call, error, busy } = useCommand();
  const existing = m.rehearsals.find((x) => x.id === id)!;
  const [form, setForm] = useState<RehForm>(() => formOf(existing));
  const [picks, setPicks] = useState<Pick[]>([]);
  const [adding, setAdding] = useState(false); // Drive picker for recordings
  const edit = useSingleEdit<CardKey>();
  const setlist = useDoc<SetlistTemplate>("setlistTemplates", existing.fromSetlistId ?? "none");
  // Existing record = autosave through rehearsals.update; no Save button.
  const as = useAutosave({ command: "rehearsals.update", id, rev: existing.rev, onUseTheirs: () => setForm(formOf(existing)) });
  // Keep the form in step with the record when it changes under us (Undo, someone else), unless we have unsaved edits.
  const serverKey = JSON.stringify(formOf(existing));
  useEffect(() => { if (!as.isBusy()) setForm(JSON.parse(serverKey)); }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (next: RehForm) => {
    if (!next.date) as.hold("Date is required"); else as.patch(rehPatch(form, next));
    setForm(next);
  };
  const flush = () => void as.flush();

  const files = m.files.filter((f) => f.rehearsalId === existing.id);
  const activeMusicians = m.musicians.filter((x) => x.active);
  const fullBand = activeMusicians.length > 0 && activeMusicians.every((x) => form.personnel.includes(x.id));
  const toggleMember = (mid: string) => change({ ...form, personnel: form.personnel.includes(mid) ? form.personnel.filter((i) => i !== mid) : [...form.personnel, mid] });
  const addSong = (sid: string) => { change({ ...form, ran: { ...form.ran, [sid]: "" } }); flush(); };
  const removeSong = (sid: string) => { const { [sid]: _gone, ...rest } = form.ran; change({ ...form, ran: rest }); flush(); };
  const timeLine = form.startTime && form.endTime ? `${fmtTime(form.startTime)} – ${fmtTime(form.endTime)}` : form.startTime ? fmtTime(form.startTime) : "";
  const ranIds = Object.keys(form.ran);

  const loc = existing.location;
  const hasLoc = !!(loc?.name || loc?.address);
  const mapsQuery = loc?.address ?? (loc?.lat !== undefined && loc?.lng !== undefined ? `${loc.lat},${loc.lng}` : loc?.name);
  const setLocation = (p: Place) => void call("rehearsals.setLocation", { id: existing.id, location: placeOf(p) });
  const where = hasLoc ? (
    <div className="grid gap-1">
      {loc?.name && <span className="font-semibold" data-testid="reh-location-name">{loc.name}</span>}
      {loc?.address && <span data-testid="reh-location-address">{loc.address}</span>}
      {mapsQuery && <a className="text-sm underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}>Open in Maps</a>}
    </div>
  ) : <span className="d-muted">{admin ? "No address yet. Add one so members can get directions and log gas in one tap." : "No address yet. An admin will add it. You can still log gas by typing where you drove."}</span>;
  const archive = async () => { if (confirm("Archive this rehearsal?") && (await call("rehearsals.remove", { id: existing.id }))) router.push("/rehearsals"); };

  return (
    <DetailPage testid="rehearsal-page" back={<Link href="/rehearsals" className="back-link" data-testid="back">← All rehearsals</Link>}
      title={`Rehearsal · ${fmtLong(form.date)}`}
      meta={<span data-testid="reh-times">{[timeLine, loc?.name ?? loc?.address ?? "", fullBand ? "Full band" : ""].filter(Boolean).join(" · ")}</span>}
      more={<div className="flex flex-wrap items-center gap-2">
        {admin && <SaveStatus {...as.statusProps} />}
        <Link href={`/money/expense?rehearsalId=${existing.id}`} className="btn acc" data-testid="reh-add-expense">+ Add an expense</Link>
        {admin && <Menu label="More actions" testid="reh" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>}
          items={[{ key: "archive", label: "Archive", danger: true, disabled: busy, onSelect: archive }]} />}
      </div>}>
      <Tabs<Tab> testid="reh-tab" value={tab} onChange={setTab} options={[["info", "Info"], ["money", "Money"]]} />
      <ErrorBox error={error} />

      {tab === "info" && <>
        <DetailCard private title="When & where" testid="reh-when-card" editKey="when" edit={admin ? edit : undefined} editTestid="reh-when-edit" doneTestid="reh-when-done" onDone={flush}
          editChildren={
            <div className="grid gap-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1"><span className="lbl">Date</span>
                  <input type="date" className="input !w-auto" value={form.date} onChange={(e) => change({ ...form, date: e.target.value })} onBlur={flush} required data-testid="reh-date" /></label>
                <label className="grid gap-1"><span className="lbl">Start</span>
                  <input type="time" className="input !w-auto" value={form.startTime} onChange={(e) => change({ ...form, startTime: e.target.value })} onBlur={flush} data-testid="reh-start" /></label>
                <span className="s pb-3">–</span>
                <label className="grid gap-1"><span className="lbl">End</span>
                  <input type="time" className="input !w-auto" value={form.endTime} onChange={(e) => change({ ...form, endTime: e.target.value })} onBlur={flush} data-testid="reh-end" /></label>
              </div>
              <div className="grid gap-1"><span className="lbl">Where</span>
                {hasLoc && <div className="text-sm s">Now: {loc?.name ? `${loc.name}, ` : ""}{loc?.address}</div>}
                {/* Picking a suggestion saves it at once (rehearsals.setLocation). */}
                <LocationSearch initial="" onPick={setLocation} />
              </div>
            </div>
          }>
          <KV rows={[["Date", fmtLong(form.date)], ["Time", timeLine, "reh-time"], ["Location", where],
            ["Calendar", <CalendarSend key="cal" kind="rehearsals" id={existing.id} eventId={existing.calendarEventId} admin={admin} beforeOpen={() => as.flush()} testid="reh-calendar" />]]} />
        </DetailCard>

        <DetailCard private title="Band members" testid="reh-members-card" headerExtra={fullBand ? <span className="d-muted text-sm">Full band</span> : undefined}>
          <ul className="m-0 grid list-none p-0">
            {activeMusicians.map((x) => (
              <li key={x.id} className="d-row" data-testid="reh-member-row">
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-soft text-sm font-bold">{x.name.charAt(0)}</span>
                  <span className="min-w-0 font-semibold">{x.name}{x.instruments.length > 0 && <span className="d-muted font-normal"> · {x.instruments.join(", ")}</span>}</span>
                </span>
                <label className="flex min-h-[44px] items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={form.personnel.includes(x.id)} disabled={!admin} onChange={() => toggleMember(x.id)} data-testid="reh-member-coming" />Coming
                </label>
              </li>
            ))}
          </ul>
        </DetailCard>

        <DetailCard private title={<>Songs <span className="d-muted font-medium">· {ranIds.length}</span></>} testid="reh-songs-card"
          headerExtra={admin ? <ImportSetlistDialog rehearsalId={existing.id} songCount={existing.songs.length} /> : undefined}>
          {admin && <SongSearch songs={m.songs} exclude={ranIds} onAdd={addSong} testid="reh-song-search" />}
          {ranIds.length === 0 ? <div className="d-muted">No songs yet.{admin ? " Import a setlist or add songs above." : ""}</div> : (
            <ol className="m-0 grid list-none p-0" data-testid="rehearsal-songs">
              {ranIds.map((sid, i) => (
                <li key={sid} className="d-row !flex-nowrap" data-testid={`reh-song-row-${titleOf(m, sid)}`}>
                  <Link href={`/rehearsals/${existing.id}/songs/${sid}`} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3" data-testid="reh-song-open">
                    <span className="w-5 shrink-0 text-sm d-muted">{i + 1}</span>
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-semibold">{titleOf(m, sid)}</span>
                      {form.ran[sid] && <span className="truncate text-sm d-muted">{form.ran[sid]}</span>}
                    </span>
                    <span aria-hidden className="shrink-0 text-xl d-muted">›</span>
                  </Link>
                  {admin && <button type="button" aria-label={`Remove ${titleOf(m, sid)}`} className="min-h-[44px] min-w-[44px] shrink-0 border-0 bg-transparent text-lg s" disabled={busy}
                    onClick={() => removeSong(sid)} data-testid="reh-song-remove">×</button>}
                </li>
              ))}
            </ol>
          )}
          {existing.fromSetlistId && (
            <div className="text-xs s">Imported from template &quot;{setlist.doc?.name ?? "Setlist"}&quot; · edits here don&apos;t change the setlist</div>
          )}
        </DetailCard>

        <DetailCard private title="Notes" testid="reh-notes-card">
          {admin ? (
            // Saves through the page's autosave (a failure shows in its Saved/Couldn't save status and retries).
            <InlineValue testid="reh-notes" label="Notes" kind="textarea" value={form.notes} canEdit
              onSave={async (next) => { change({ ...form, notes: next }); await as.flush(); return true; }} />
          ) : form.notes ? <p className="m-0 whitespace-pre-wrap">{form.notes}</p> : <span className="d-muted">No notes.</span>}
        </DetailCard>

        <DetailCard private title="Recordings" testid="reh-recordings-card"
          headerExtra={admin ? <button type="button" className="btn ghost sm" onClick={() => setAdding(!adding)} data-testid="reh-add-recording">{adding ? "Cancel" : "Attach from Google Drive"}</button> : undefined}>
          {adding && (
            <div className="grid gap-2">
              <DrivePicker syncWith={`Rehearsal ${existing.date}`} exclude={files.flatMap((f) => f.driveFileId ?? [])} defaultKind="rehearsal" onChange={setPicks} />
              <button type="button" className="btn acc justify-self-start" disabled={busy || picks.length === 0} data-testid="reh-attach" onClick={async () => { if (await call("files.attach", { rehearsalId: existing.id, files: picks })) { setAdding(false); setPicks([]); } }}>Attach {picks.length || ""} recording{picks.length === 1 ? "" : "s"}</button>
            </div>
          )}
          {admin && <NewRecordings rehearsalId={existing.id} songs={ranIds.map((sid) => ({ id: sid, title: titleOf(m, sid) }))} />}
          <div className="grid" data-testid="rehearsal-files">
            {files.map((f: FileRow) => (
              <RecordingRow key={f.id} file={f}
                remove={admin && <button type="button" aria-label="Remove recording" className="min-h-[44px] min-w-[44px] border-0 bg-transparent text-lg s" disabled={busy} onClick={() => call("files.remove", { id: f.id })} data-testid="file-remove">×</button>} />
            ))}
            {files.length === 0 && <span className="d-muted">No recordings yet.</span>}
          </div>
          <div className="text-xs s">Files stay in Drive — the app stores links only.</div>
        </DetailCard>
      </>}

      {tab === "money" && <ExpensesCardFor target={{ kind: "rehearsal", id: existing.id }} admin={admin} />}
    </DetailPage>
  );
}
