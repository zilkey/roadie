"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { todayStr } from "@/lib/booking";
import { BackTo, FileIcon, Missing, bandMembers, fmtDay, useMusic } from "@/components/music/common";
import { DrivePicker, type Pick } from "@/components/music/DrivePicker";
import { playerFor } from "@/lib/music";

export default function RehearsalPage() {
  const { id } = useParams<{ id: string }>();
  const m = useMusic();
  const admin = useProfile().role === "admin";
  const r = id === "new" ? null : m.rehearsals.find((x) => x.id === id);
  if (m.loading) return <div className="s">Loading…</div>;
  if (id === "new" && !admin) return <Missing what="rehearsal" />;
  if (id !== "new" && !r) return <Missing what="rehearsal" />;
  return <View id={id} m={m} admin={admin} />;
}

function View({ id, m, admin }: { id: string; m: ReturnType<typeof useMusic>; admin: boolean }) {
  const router = useRouter();
  const { call, error, busy } = useCommand();
  const existing = id === "new" ? null : m.rehearsals.find((x) => x.id === id)!;
  const members = bandMembers(m.musicians);
  const [date, setDate] = useState(existing?.date ?? todayStr());
  const [place, setPlace] = useState(existing?.place ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [personnel, setPersonnel] = useState<string[]>(existing?.personnel ?? []);
  const [ran, setRan] = useState<Record<string, string>>(Object.fromEntries((existing?.songs ?? []).map((s) => [s.songId, s.note ?? ""])));
  const [picks, setPicks] = useState<Pick[]>([]);
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setSaved(false); }, [date, place, notes, personnel, ran]);

  const files = existing ? m.files.filter((f) => f.rehearsalId === existing.id) : [];
  const songs = m.songs.filter((s) => s.status !== "retired" && s.status !== "idea" || ran[s.id] !== undefined).sort((a, b) => a.title.localeCompare(b.title));
  const nameOf = (mid: string) => m.musicians.find((x) => x.id === mid)?.name ?? "Someone";
  const toggleSong = (sid: string) => setRan((r) => { const { [sid]: on, ...rest } = r; return on !== undefined ? rest : { ...r, [sid]: "" }; });
  const songList = Object.entries(ran).map(([songId, note]) => ({ songId, ...(note.trim() ? { note: note.trim() } : {}) }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (existing) {
      const r = await call("rehearsals.update", { id: existing.id, patch: { date, place: place.trim() || null, notes: notes.trim() || null, personnel, songs: songList } });
      if (r) setSaved(true);
    } else {
      const r = await call("rehearsals.create", { date, ...(place.trim() ? { place: place.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}), personnel, songs: songList, files: picks });
      if (r?.id) router.push(`/songs/rehearsals/${r.id}`);
    }
  }

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

  if (!admin && existing) {
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
    <form className="grid gap-3" onSubmit={save} data-testid="rehearsal-page">
      <BackTo href="/songs" label="Songs" />
      <PageTitle title={existing ? "Rehearsal" : "Log a rehearsal"} sub="Check off what we ran. That's what powers 'last rehearsed'." />
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1"><span className="lbl">When</span><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required data-testid="reh-date" /></label>
        <label className="grid gap-1"><span className="lbl">Where</span><input className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Jeff's basement" data-testid="reh-place" /></label>
      </div>
      <span className="lbl">Who was there</span>
      <div className="flex flex-wrap gap-1.5">
        {m.musicians.filter((x) => x.active).map((x) => (
          <button key={x.id} type="button" className={`btn sm ${personnel.includes(x.id) ? "acc" : "ghost"}`} aria-pressed={personnel.includes(x.id)} data-testid={`reh-who-${x.name}`}
            onClick={() => setPersonnel((p) => (p.includes(x.id) ? p.filter((i) => i !== x.id) : [...p, x.id]))}>{x.name}</button>
        ))}
      </div>
      <span className="lbl">We ran</span>
      <div className="grid gap-1.5" data-testid="reh-songs">
        {songs.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-2 text-sm"><input type="checkbox" checked={ran[s.id] !== undefined} onChange={() => toggleSong(s.id)} data-testid={`reh-song-${s.title}`} />{s.title}</label>
            {ran[s.id] !== undefined && <input className="input !w-1/2" placeholder="Note" value={ran[s.id]} onChange={(e) => setRan((r) => ({ ...r, [s.id]: e.target.value }))} aria-label={`Note for ${s.title}`} data-testid={`reh-note-${s.title}`} />}
          </div>
        ))}
      </div>
      <label className="grid gap-1"><span className="lbl">Notes</span><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="reh-notes" /></label>
      {fileList}
      {existing ? (
        <div className="grid gap-2">
          <button type="button" className="btn ghost justify-self-start" onClick={() => setAdding(!adding)} data-testid="reh-add-recording">{adding ? "Cancel" : "+ Add recording from Drive"}</button>
          {adding && (
            <div className="card">
              <DrivePicker syncWith={`Rehearsal ${existing.date}`} exclude={files.map((f) => f.driveFileId)} defaultKind="rehearsal" onChange={setPicks} />
              <button type="button" className="btn acc" disabled={busy || picks.length === 0} data-testid="reh-attach" onClick={async () => { if (await call("files.attach", { rehearsalId: existing.id, files: picks })) { setAdding(false); setPicks([]); } }}>Attach {picks.length || ""} recording{picks.length === 1 ? "" : "s"}</button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-2"><span className="lbl">Recording</span><DrivePicker defaultKind="rehearsal" onChange={setPicks} testid="picker" /></div>
      )}
      <div className="flex items-center gap-2">
        <button className="btn acc" disabled={busy} data-testid="reh-save">{existing ? "Save" : "Save rehearsal"}</button>
        {saved && <span className="s" data-testid="reh-saved">Saved</span>}
        {existing && <button type="button" className="btn ghost" disabled={busy} data-testid="reh-archive" onClick={async () => { if (confirm("Archive this rehearsal?") && (await call("rehearsals.remove", { id: existing.id }))) router.push("/songs"); }}>Archive</button>}
      </div>
      <ErrorBox error={error} />
    </form>
  );
}
