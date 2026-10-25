"use client";
import { draftPath } from "@/schema/drafts";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorBox, PageTitle, PickChip, useCommand } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { todayStr } from "@/lib/booking";
import { Menu } from "@/components/Menu";
import { FileIcon, Missing, useMusic, type FileRow } from "@/components/music/common";
import { DrivePicker, type Pick } from "@/components/music/DrivePicker";
import { playerFor } from "@/lib/music";
import { fmtLong, fmtTime } from "@/lib/shows";
import { SaveStatus } from "@/components/SaveStatus";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useAutosave } from "@/lib/autosave";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useDoc } from "@/lib/firestore-hooks";
import type { Rehearsal, RehearsalLocation, Setlist } from "@/schema";
import ImportSetlistDialog from "./ImportSetlistDialog";
import RehearsalExpenses from "./RehearsalExpenses";

export default function RehearsalPage() {
  const { id } = useParams<{ slug: string; id: string }>();
  const m = useMusic();
  const admin = useProfile().role === "admin";
  const r = id === "new" ? null : m.rehearsals.find((x) => x.id === id);
  if (m.loading) return <div className="s">Loading…</div>;
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

/** Songs that can be picked for a rehearsal: active ones, plus any already run (so they can be unticked). */
function pickableSongs(m: Music, ran: Record<string, string>) {
  return m.songs
    .filter((s) => (s.status !== "retired" && s.status !== "idea") || ran[s.id] !== undefined)
    .sort((a, b) => a.title.localeCompare(b.title));
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

/** Location card: the place and address, Open in Maps; admins change it (saved at once) or, with none yet, add it. */
function LocationCard({ r, admin }: { r: Row; admin: boolean }) {
  const { call, error, busy } = useCommand();
  const [changing, setChanging] = useState(false);
  const [pending, setPending] = useState<Place | null>(null);
  const loc = r.location;
  const hasLoc = !!(loc?.name || loc?.address);
  const mapsQuery = loc?.address ?? (loc?.lat !== undefined && loc?.lng !== undefined ? `${loc.lat},${loc.lng}` : loc?.name);

  async function save(p: Place) {
    const ok = await call("rehearsals.setLocation", { id: r.id, location: placeOf(p) });
    if (ok) { setChanging(false); setPending(null); }
  }

  return (
    <section className="card" data-testid="reh-location-card">
      <div className="flex items-center justify-between gap-2">
        <span className="card-h">Location</span>
        {admin && hasLoc && (
          <button type="button" className="btn ghost sm" onClick={() => setChanging(!changing)} data-testid="reh-location-change">{changing ? "Cancel" : "Change"}</button>
        )}
      </div>
      {hasLoc && !changing ? (
        <div className="grid gap-1">
          {loc?.name && <span className="font-semibold" data-testid="reh-location-name">{loc.name}</span>}
          {loc?.address && <span className="text-sm" data-testid="reh-location-address">{loc.address}</span>}
          {mapsQuery && (
            <a className="text-sm" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}>Open in Maps</a>
          )}
        </div>
      ) : admin ? (
        <div className="grid gap-2">
          {!hasLoc && <p className="text-sm s">No address yet. Add one so members can get directions and log gas in one tap.</p>}
          <LocationSearch initial="" onPick={(p) => (hasLoc ? void save(p) : setPending(p))} />
          {!hasLoc && (
            <button type="button" className="btn acc justify-self-start" disabled={!pending || busy} onClick={() => pending && save(pending)} data-testid="reh-location-save">Save</button>
          )}
          <ErrorBox error={error} />
        </div>
      ) : (
        <p className="text-sm s">No address yet. An admin will add it. You can still log gas by typing where you drove.</p>
      )}
    </section>
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
  const songs = pickableSongs(m, v.ran);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await draft.settle();
    const r = await call("rehearsals.create", {
      date: v.date, ...(v.location ? { location: v.location } : {}), ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
      personnel: v.personnel, songs: songList(v.ran), files: picks,
    }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r?.id) { await draft.clear(); router.push(`/songs/rehearsals/${r.id}`); }
  }

  return (
    <form className="grid gap-5" onSubmit={save} data-testid="rehearsal-page">
      <PageTitle back={<Link href="/songs?seg=rehearsals" className="back-link" data-testid="back">← All rehearsals</Link>} title="Log a rehearsal" sub="Check off what we ran. That's what powers 'last rehearsed'." />
      {!draft.ready ? <span className="s">Loading…</span> : <div className="cols">
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
            <span className="lbl">Who was there</span>
            <div className="flex flex-wrap gap-1.5">
              {m.musicians.filter((x) => x.active).map((x) => (
                <PickChip key={x.id} on={v.personnel.includes(x.id)} testid={`reh-who-${x.name}`}
                  onToggle={() => draft.setValue({ ...v, personnel: v.personnel.includes(x.id) ? v.personnel.filter((i) => i !== x.id) : [...v.personnel, x.id] })}>{x.name}</PickChip>
              ))}
            </div>
            <span className="lbl">We ran</span>
            <div className="grid gap-1.5" data-testid="reh-songs">
              {songs.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <label className="flex flex-1 items-center gap-2 text-sm"><input type="checkbox" checked={v.ran[s.id] !== undefined} onChange={() => {
                    const { [s.id]: on, ...rest } = v.ran;
                    draft.setValue({ ...v, ran: on !== undefined ? rest : { ...v.ran, [s.id]: "" } });
                  }} data-testid={`reh-song-${s.title}`} />{s.title}</label>
                  {v.ran[s.id] !== undefined && <input className="input !w-1/2" placeholder="Note" value={v.ran[s.id]} onChange={(e) => draft.setValue({ ...v, ran: { ...v.ran, [s.id]: e.target.value } })} aria-label={`Note for ${s.title}`} data-testid={`reh-note-${s.title}`} />}
                </div>
              ))}
            </div>
            <label className="grid gap-1"><span className="lbl">Notes</span><textarea className="input" rows={2} value={v.notes} onChange={(e) => draft.setValue({ ...v, notes: e.target.value })} data-testid="reh-notes" /></label>
            <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
            <div className="flex items-center gap-2">
              <button className="btn acc" disabled={busy || !v.date} data-testid="reh-save">Save rehearsal</button>
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

function ExistingRehearsal({ id, m, admin }: { id: string; m: Music; admin: boolean }) {
  const router = useRouter();
  const { call, error, busy } = useCommand();
  const existing = m.rehearsals.find((x) => x.id === id)!;
  const [form, setForm] = useState<RehForm>(() => formOf(existing));
  const [picks, setPicks] = useState<Pick[]>([]);
  const [adding, setAdding] = useState(false); // Drive picker for recordings
  const [picking, setPicking] = useState(false); // song picker
  const [editing, setEditing] = useState(false); // song notes and the notes field
  const setlist = useDoc<Setlist>("setlists", existing.fromSetlistId ?? "none");
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
  const activeMusicians = m.musicians.filter((x) => x.active);
  const fullBand = activeMusicians.length > 0 && activeMusicians.every((x) => form.personnel.includes(x.id));
  const toggleMember = (mid: string) => edit({ ...form, personnel: form.personnel.includes(mid) ? form.personnel.filter((i) => i !== mid) : [...form.personnel, mid] });
  const toggleSong = (sid: string) => { const { [sid]: on, ...rest } = form.ran; edit({ ...form, ran: on !== undefined ? rest : { ...form.ran, [sid]: "" } }); };
  const timeLine = form.startTime && form.endTime ? `${fmtTime(form.startTime)} – ${fmtTime(form.endTime)}` : form.startTime ? fmtTime(form.startTime) : "";
  const songs = pickableSongs(m, form.ran);

  return (
    <div className="grid gap-5" data-testid="rehearsal-page">
      <PageTitle
        back={<Link href="/songs?seg=rehearsals" className="back-link" data-testid="back">← All rehearsals</Link>}
        title={`Rehearsal · ${fmtLong(form.date)}`}
        sub={admin ? (
          <span className="flex flex-wrap items-center gap-2">
            <input type="date" className="input !w-auto" value={form.date} onChange={(e) => edit({ ...form, date: e.target.value })} onBlur={() => void as.flush()} required aria-label="Date" data-testid="reh-date" />
            <input type="time" className="input !w-auto" value={form.startTime} onChange={(e) => edit({ ...form, startTime: e.target.value })} onBlur={() => void as.flush()} aria-label="Start time" data-testid="reh-start" />
            <span className="s">–</span>
            <input type="time" className="input !w-auto" value={form.endTime} onChange={(e) => edit({ ...form, endTime: e.target.value })} onBlur={() => void as.flush()} aria-label="End time" data-testid="reh-end" />
            {fullBand && <span className="s">· Full band</span>}
          </span>
        ) : <span data-testid="reh-times">{[timeLine, fullBand ? "Full band" : ""].filter(Boolean).join(" · ")}</span>}
        actions={<>
          {admin && <SaveStatus {...as.statusProps} />}
          {admin && <button type="button" className="btn ghost" onClick={() => setEditing(!editing)} data-testid="reh-edit">{editing ? "Done" : "Edit"}</button>}
          <Link href={`/money/expense?rehearsalId=${existing.id}`} className="btn acc" data-testid="reh-add-expense">+ Add an expense</Link>
          {admin && (
            <Menu label="More actions" testid="reh" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>}
              items={[{ key: "archive", label: "Archive", danger: true, disabled: busy, onSelect: async () => { if (confirm("Archive this rehearsal?") && (await call("rehearsals.remove", { id: existing.id }))) router.push("/songs"); } }]} />
          )}
        </>} />

      <div className="cols">
        <div className="col-main">
          <LocationCard r={existing} admin={admin} />

          <section className="card" data-testid="reh-songs-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="card-h">Songs <span className="s font-medium">· {Object.keys(form.ran).length}</span></span>
              {admin && (
                <div className="flex flex-wrap gap-2">
                  <ImportSetlistDialog rehearsalId={existing.id} songCount={existing.songs.length} />
                  <button type="button" className="btn ghost sm" onClick={() => setPicking(!picking)} data-testid="reh-add-song">{picking ? "Done" : "+ Song"}</button>
                </div>
              )}
            </div>
            {picking && (
              <div className="grid gap-1.5 rounded-lg border border-line p-2.5" data-testid="reh-song-picker">
                {songs.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.ran[s.id] !== undefined} onChange={() => toggleSong(s.id)} data-testid={`reh-song-${s.title}`} />{s.title}
                  </label>
                ))}
                {songs.length === 0 && <span className="s">No songs to add.</span>}
              </div>
            )}
            <ol className="m-0 grid list-none p-0" data-testid="rehearsal-songs">
              {Object.keys(form.ran).map((sid, i) => (
                <li key={sid} className="flex items-center gap-3 border-t border-line py-2.5">
                  <span className="w-5 text-sm s">{i + 1}</span>
                  <Link href={`/songs/${sid}`} className="min-w-0 flex-1 truncate text-sm font-semibold">{titleOf(m, sid)}</Link>
                  {editing ? (
                    <input className="input !w-1/2" placeholder="Note" value={form.ran[sid]} onChange={(e) => edit({ ...form, ran: { ...form.ran, [sid]: e.target.value } })} onBlur={() => void as.flush()} aria-label={`Note for ${titleOf(m, sid)}`} data-testid={`reh-note-${titleOf(m, sid)}`} />
                  ) : form.ran[sid] ? <span className="text-xs s">{form.ran[sid]}</span> : null}
                </li>
              ))}
            </ol>
            {editing ? (
              <label className="grid gap-1"><span className="lbl">Notes</span>
                <textarea className="input" rows={2} value={form.notes} onChange={(e) => edit({ ...form, notes: e.target.value })} onBlur={() => void as.flush()} data-testid="reh-notes" />
              </label>
            ) : form.notes ? <p className="text-sm">{form.notes}</p> : null}
            {existing.fromSetlistId && (
              <div className="text-xs s">Imported from setlist &quot;{setlist.doc?.name ?? "Setlist"}&quot; · edits here don&apos;t change the setlist</div>
            )}
          </section>
        </div>

        <div className="col-side">
          <section className="card" data-testid="reh-members-card">
            <div className="flex items-center justify-between gap-2">
              <span className="card-h">Band members</span>
              <span className="s">From band settings</span>
            </div>
            <ul className="m-0 grid list-none p-0">
              {activeMusicians.map((x) => (
                <li key={x.id} className="flex items-center gap-3 border-t border-line py-2" data-testid="reh-member-row">
                  <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-soft text-sm font-bold">{x.name.charAt(0)}</span>
                  <span className="min-w-0 flex-1 text-sm font-semibold">{x.name}{x.instruments.length > 0 && <span className="s font-normal"> · {x.instruments.join(", ")}</span>}</span>
                  <label className="flex min-h-[44px] items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={form.personnel.includes(x.id)} disabled={!admin} onChange={() => toggleMember(x.id)} data-testid="reh-member-coming" />Coming
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="card" data-testid="reh-recordings-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="card-h">Recordings</span>
              {admin && <button type="button" className="btn ghost sm" onClick={() => setAdding(!adding)} data-testid="reh-add-recording">{adding ? "Cancel" : "Attach from Google Drive"}</button>}
            </div>
            {adding && (
              <div className="grid gap-2">
                <DrivePicker syncWith={`Rehearsal ${existing.date}`} exclude={files.map((f) => f.driveFileId)} defaultKind="rehearsal" onChange={setPicks} />
                <button type="button" className="btn acc" disabled={busy || picks.length === 0} data-testid="reh-attach" onClick={async () => { if (await call("files.attach", { rehearsalId: existing.id, files: picks })) { setAdding(false); setPicks([]); } }}>Attach {picks.length || ""} recording{picks.length === 1 ? "" : "s"}</button>
              </div>
            )}
            <div className="grid gap-2" data-testid="rehearsal-files">
              {files.map((f: FileRow) => (
                <div key={f.id} className="flex items-center gap-2 border-t border-line pt-2" data-testid={`file-${f.id}`}>
                  <FileIcon mime={f.mimeType} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{f.title}</span>
                  {playerFor(f).mode === "audio" && <audio controls preload="none" src={f.url} className="h-8 max-w-[160px]" />}
                  <a className="text-xs font-semibold" href={f.url} target="_blank" rel="noreferrer" data-testid="file-open">Open in Drive</a>
                  {admin && <button type="button" aria-label="Remove recording" className="min-h-[44px] min-w-[44px] border-0 bg-transparent text-lg s" disabled={busy} onClick={() => call("files.remove", { id: f.id })} data-testid="file-remove">×</button>}
                </div>
              ))}
              {files.length === 0 && <span className="text-sm s">No recordings yet.</span>}
            </div>
            <div className="text-xs s">Files stay in Drive — the app stores links only.</div>
          </section>
        </div>
      </div>

      <RehearsalExpenses rehearsalId={existing.id} />
      <ErrorBox error={error} />
    </div>
  );
}
