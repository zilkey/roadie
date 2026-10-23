"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { todayStr } from "@/lib/booking";
import { BackTo, FileIcon, Missing, bandMembers, fmtDay, useMusic } from "@/components/music/common";
import { DrivePicker, type Pick } from "@/components/music/DrivePicker";
import { playerFor } from "@/lib/music";
import { SaveStatus } from "@/components/SaveStatus";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useAutosave } from "@/lib/autosave";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";

export default function RehearsalPage() {
  const { id } = useParams<{ id: string }>();
  const m = useMusic();
  const admin = useProfile().role === "admin";
  const r = id === "new" ? null : m.rehearsals.find((x) => x.id === id);
  if (m.loading) return <div className="s">Loading…</div>;
  if (id === "new" && !admin) return <Missing what="rehearsal" />;
  if (id !== "new" && !r) return <Missing what="rehearsal" />;
  // New = a draft with an explicit create button; existing = autosave. Two forms, one set of fields.
  return id === "new" ? <NewRehearsal m={m} /> : <ExistingRehearsal id={id} m={m} admin={admin} />;
}

type Music = ReturnType<typeof useMusic>;
interface RehForm { date: string; place: string; notes: string; personnel: string[]; ran: Record<string, string> }

const formOf = (r: { date: string; place?: string; notes?: string; personnel: string[]; songs: { songId: string; note?: string }[] }): RehForm => ({
  date: r.date, place: r.place ?? "", notes: r.notes ?? "", personnel: r.personnel, ran: Object.fromEntries(r.songs.map((s) => [s.songId, s.note ?? ""])),
});
const songList = (ran: Record<string, string>) => Object.entries(ran).map(([songId, note]) => ({ songId, ...(note.trim() ? { note: note.trim() } : {}) }));
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Fields only the next form state changed, as a rehearsals.update patch. */
function rehPatch(a: RehForm, b: RehForm): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (b.date !== a.date && b.date) p.date = b.date;
  if (b.place !== a.place) p.place = b.place.trim() || null;
  if (b.notes !== a.notes) p.notes = b.notes.trim() || null;
  if (!sameJson(a.personnel, b.personnel)) p.personnel = b.personnel;
  if (!sameJson(a.ran, b.ran)) p.songs = songList(b.ran);
  return p;
}

function RehFields({ value, onChange, onBlur, m, existingRan }: { value: RehForm; onChange(v: RehForm): void; onBlur?(): void; m: Music; existingRan?: Record<string, string> }) {
  const { date, place, notes, personnel, ran } = value;
  const songs = m.songs.filter((s) => s.status !== "retired" && s.status !== "idea" || ran[s.id] !== undefined || existingRan?.[s.id] !== undefined).sort((a, b) => a.title.localeCompare(b.title));
  const toggleSong = (sid: string) => { const { [sid]: on, ...rest } = ran; onChange({ ...value, ran: on !== undefined ? rest : { ...ran, [sid]: "" } }); };
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1"><span className="lbl">When</span><input type="date" className="input" value={date} onChange={(e) => onChange({ ...value, date: e.target.value })} onBlur={onBlur} required data-testid="reh-date" /></label>
        <label className="grid gap-1"><span className="lbl">Where</span><input className="input" value={place} onChange={(e) => onChange({ ...value, place: e.target.value })} onBlur={onBlur} placeholder="Jeff's basement" data-testid="reh-place" /></label>
      </div>
      <span className="lbl">Who was there</span>
      <div className="flex flex-wrap gap-1.5">
        {m.musicians.filter((x) => x.active).map((x) => (
          <button key={x.id} type="button" className={`btn sm ${personnel.includes(x.id) ? "acc" : "ghost"}`} aria-pressed={personnel.includes(x.id)} data-testid={`reh-who-${x.name}`}
            onClick={() => onChange({ ...value, personnel: personnel.includes(x.id) ? personnel.filter((i) => i !== x.id) : [...personnel, x.id] })}>{x.name}</button>
        ))}
      </div>
      <span className="lbl">We ran</span>
      <div className="grid gap-1.5" data-testid="reh-songs">
        {songs.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-2 text-sm"><input type="checkbox" checked={ran[s.id] !== undefined} onChange={() => toggleSong(s.id)} data-testid={`reh-song-${s.title}`} />{s.title}</label>
            {ran[s.id] !== undefined && <input className="input !w-1/2" placeholder="Note" value={ran[s.id]} onChange={(e) => onChange({ ...value, ran: { ...ran, [s.id]: e.target.value } })} onBlur={onBlur} aria-label={`Note for ${s.title}`} data-testid={`reh-note-${s.title}`} />}
          </div>
        ))}
      </div>
      <label className="grid gap-1"><span className="lbl">Notes</span><textarea className="input" rows={2} value={notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} onBlur={onBlur} data-testid="reh-notes" /></label>
    </>
  );
}

/** New rehearsal: values are a draft (device + server); "Save rehearsal" creates it. */
function NewRehearsal({ m }: { m: Music }) {
  const router = useRouter();
  const { call, error, busy } = useCommand();
  const draft = useDraft<RehForm>("rehearsal", "new", { date: todayStr(), place: "", notes: "", personnel: [], ran: {} }, { title: (v) => `New rehearsal · ${v.date}${v.place ? ` · ${v.place}` : ""}` });
  const [picks, setPicks] = useState<Pick[]>([]);
  const mutationId = useRef(newMutationId());
  const v = draft.value;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await draft.settle();
    const r = await call("rehearsals.create", {
      date: v.date, ...(v.place.trim() ? { place: v.place.trim() } : {}), ...(v.notes.trim() ? { notes: v.notes.trim() } : {}), personnel: v.personnel, songs: songList(v.ran), files: picks,
    }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r?.id) { await draft.clear(); router.push(`/songs/rehearsals/${r.id}`); }
  }

  return (
    <form className="grid gap-3" onSubmit={save} data-testid="rehearsal-page">
      <BackTo href="/songs" label="Songs" />
      <PageTitle title="Log a rehearsal" sub="Check off what we ran. That's what powers 'last rehearsed'." />
      {!draft.ready ? <span className="s">Loading…</span> : <>
        <RehFields value={v} onChange={draft.setValue} m={m} />
        <div className="grid gap-2"><span className="lbl">Recording</span><DrivePicker defaultKind="rehearsal" onChange={setPicks} testid="picker" /></div>
        <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
        <div className="flex items-center gap-2">
          <button className="btn acc" disabled={busy || !v.date} data-testid="reh-save">Save rehearsal</button>
        </div>
        <ErrorBox error={error} />
      </>}
    </form>
  );
}

function ExistingRehearsal({ id, m, admin }: { id: string; m: Music; admin: boolean }) {
  const router = useRouter();
  const { call, error, busy } = useCommand();
  const existing = m.rehearsals.find((x) => x.id === id)!;
  const [form, setForm] = useState<RehForm>(() => formOf(existing));
  const [picks, setPicks] = useState<Pick[]>([]);
  const [adding, setAdding] = useState(false);
  // Existing record = autosave through rehearsals.update; no Save button.
  const as = useAutosave({ command: "rehearsals.update", id, rev: existing.rev, onUseTheirs: () => setForm(formOf(existing)) });
  // Keep the form in step with the record when it changes under us (Undo, someone else), unless we have unsaved edits.
  const serverKey = JSON.stringify(formOf(existing));
  useEffect(() => { if (!as.isBusy()) setForm(JSON.parse(serverKey)); }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (next: RehForm) => {
    if (!next.date) as.hold("Date is required"); else as.patch(rehPatch(form, next));
    setForm(next);
  };

  const files = m.files.filter((f) => f.rehearsalId === existing.id);
  const nameOf = (mid: string) => m.musicians.find((x) => x.id === mid)?.name ?? "Someone";

  const fileList = files.length > 0 && (
    <div className="grid gap-2" data-testid="rehearsal-files">
      <span className="lbl">Recordings</span>
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-2 rounded-lg border border-line p-2" data-testid={`file-${f.id}`}>
          <FileIcon mime={f.mimeType} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{f.title}</span>
          {playerFor(f).mode === "audio" && <audio controls preload="none" src={f.url} className="h-8" />}
          <a className="btn ghost sm" href={f.url} target="_blank" rel="noreferrer" data-testid="file-open">Open in Drive</a>
          {admin && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => call("files.remove", { id: f.id })} data-testid="file-remove">Remove</button>}
        </div>
      ))}
    </div>
  );

  if (!admin) {
    return (
      <div className="grid gap-3" data-testid="rehearsal-page">
        <BackTo href="/songs" label="Songs" />
        <PageTitle title="Rehearsal" sub={`${fmtDay(existing.date)}${existing.place ? ` · ${existing.place}` : ""}`} />
        <span className="lbl">Who was there</span>
        <span className="text-sm">{existing.personnel.map(nameOf).join(", ") || "Not recorded"}</span>
        <span className="lbl">We ran</span>
        <ul className="grid gap-1" data-testid="rehearsal-songs">
          {existing.songs.map((s) => <li key={s.songId}><Link href={`/songs/${s.songId}`} className="font-semibold">{s.title}</Link>{s.note && <span className="s"> · {s.note}</span>}</li>)}
        </ul>
        {existing.notes && <p className="text-sm">{existing.notes}</p>}
        {fileList}
      </div>
    );
  }

  return (
    <div className="grid gap-3" data-testid="rehearsal-page">
      <BackTo href="/songs" label="Songs" />
      <PageTitle title="Rehearsal" sub="Check off what we ran. That's what powers 'last rehearsed'." />
      <SaveStatus {...as.statusProps} />
      <RehFields value={form} onChange={edit} onBlur={() => void as.flush()} m={m} existingRan={Object.fromEntries(existing.songs.map((s) => [s.songId, s.note ?? ""]))} />
      {fileList}
      <div className="grid gap-2">
        <button type="button" className="btn ghost justify-self-start" onClick={() => setAdding(!adding)} data-testid="reh-add-recording">{adding ? "Cancel" : "+ Add recording from Drive"}</button>
        {adding && (
          <div className="card">
            <DrivePicker syncWith={`Rehearsal ${existing.date}`} exclude={files.map((f) => f.driveFileId)} defaultKind="rehearsal" onChange={setPicks} />
            <button type="button" className="btn acc" disabled={busy || picks.length === 0} data-testid="reh-attach" onClick={async () => { if (await call("files.attach", { rehearsalId: existing.id, files: picks })) { setAdding(false); setPicks([]); } }}>Attach {picks.length || ""} recording{picks.length === 1 ? "" : "s"}</button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn ghost" disabled={busy} data-testid="reh-archive" onClick={async () => { if (confirm("Archive this rehearsal?") && (await call("rehearsals.remove", { id: existing.id }))) router.push("/songs"); }}>Archive</button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
