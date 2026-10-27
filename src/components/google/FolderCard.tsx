"use client";
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import type { Folder, Status } from "./shared";

/** What each folder card says and which command saves it. Test ids keep the band folder's "band-folder-*" names. */
const FOLDERS = {
  band: {
    title: "Band folder", command: "google.setBandFolder", tid: "band-folder", card: "google-band-folder",
    saved: "Band folder saved. Run the sharing check on a song to update which files are in it.",
    is: "Song files are checked against it: anything outside it (and outside the Charts folder) shows as outside the band folder.",
    unset: "Not chosen yet. Until you choose the band's shared folder, song files aren't checked against it.",
  },
  charts: {
    title: "Charts folder", command: "google.setChartsFolder", tid: "charts-folder", card: "google-charts-folder",
    saved: "Charts folder saved. Copy to band folder puts copies here now.",
    is: "Lyrics, chord sheets and other charts. Copy to band folder on a song puts its copies here, shared with the band.",
    unset: "Not chosen yet. This is where lyrics, chord sheets and other charts go; Copy to band folder stays off until you choose it.",
  },
  demos: {
    title: "Demos folder", command: "google.setDemosFolder", tid: "demos-folder", card: "google-demos-folder",
    saved: "Demos folder saved. Upload a demo on a song puts it here now.",
    is: "Demos and other audio uploaded to a song go here, shared with the band.",
    unset: "Not chosen yet. This is where audio uploaded to a song goes; Upload a demo stays off until you choose it.",
  },
  songwriting: {
    title: "Songwriting folder", command: "google.setSongwritingFolder", tid: "songwriting-folder", card: "google-songwriting-folder",
    saved: "Songwriting folder saved. Upload audio on a Writing song puts it here now.",
    is: "Audio uploaded to a song in the Writing phase goes here, shared with the band.",
    unset: "Not chosen yet. This is where audio uploaded to a Writing song goes; Upload audio on those songs stays off until you choose it.",
  },
  rehearsal: {
    title: "Rehearsal recordings folder", command: "google.setRehearsalFolder", tid: "rehearsal-folder", card: "google-rehearsal-folder",
    saved: "Rehearsal recordings folder saved.",
    is: "Recordings uploaded on a song at a rehearsal go here, in a folder for the rehearsal's date.",
    unset: "Not chosen yet. Uploading a recording at a rehearsal stays off until you choose where they go.",
  },
} as const;

/**
 * A Drive folder setting: the band folder (song files are checked against it), the Charts folder (lyrics and chord
 * sheets; Copy to band folder copies into it), the Demos folder (audio uploaded to a song goes into it), the Songwriting folder (the same, for songs in the Writing phase) or the rehearsal recordings folder (uploads from a rehearsal go into it). Chosen by searching the band account's Drive for folders by
 * name, or by pasting a folder link. Until it's set, what depends on it is off everywhere.
 */
export function FolderCard({ which, status, onChange }: { which: keyof typeof FOLDERS; status: Status; onChange(s: Status): void }) {
  const c = FOLDERS[which];
  const { call, error, busy, setError } = useCommand();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Folder[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const f = { band: status.bandFolder, charts: status.chartsFolder, demos: status.demosFolder, songwriting: status.songwritingFolder, rehearsal: status.rehearsalFolder }[which];
  const isLink = /drive\.google\.com|\/folders\//.test(q);

  async function choose(folder: string) {
    const s = await call<Status>(c.command, { folder });
    if (!s) return;
    onChange(s); setOpen(false); setQ(""); setFound(null);
    setNote(c.saved);
  }
  async function find(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    if (isLink) return choose(q.trim());
    const r = await call<{ folders: Folder[] }>("google.findFolders", { q: q.trim() });
    if (r) setFound(r.folders);
  }

  return (
    <section className={`card${open ? " editing" : ""}`} data-testid={c.card} aria-labelledby={`google-${c.tid}-title`}>
      <div className="card-head">
        <h2 id={`google-${c.tid}-title`}>{c.title}</h2>
        {status.driveReady && !open && (
          <button type="button" className="card-edit" onClick={() => { setOpen(true); setNote(null); setError(null); }} data-testid={`${c.tid}-change`}>{f ? "Change" : "Choose"}</button>
        )}
      </div>
      <p className="m-0" data-testid={`${c.tid}-status`}>
        {f?.name ? <><a href={f.url ?? undefined} target="_blank" rel="noreferrer" data-testid={`${c.tid}-link`}><b>{f.name}</b> ↗</a>. {c.is}</>
          : f ? <>Drive can&apos;t open the saved folder ({f.error ?? "unknown error"}). Choose it again.</>
          : c.unset}
      </p>
      {!status.driveReady && <p className="s m-0" data-testid={`${c.tid}-needs-drive`}>Connect Drive on the band&apos;s Google account (above) to choose it.</p>}
      {note && <p className="s m-0" role="status" data-testid={`${c.tid}-note`}>{note}</p>}
      {open && (
        <form className="grid gap-2" onSubmit={find} data-testid={`${c.tid}-form`}>
          <label htmlFor={`${c.tid}-q`} className="lbl">Folder name, or paste a Drive folder link</label>
          <div className="flex gap-2">
            <input id={`${c.tid}-q`} className="input" value={q} autoFocus onChange={(e) => { setQ(e.target.value); setFound(null); setError(null); }} data-testid={`${c.tid}-q`} />
            <button className="btn ghost" disabled={busy || !q.trim()} data-testid={`${c.tid}-search`}>{isLink ? "Use link" : "Search"}</button>
          </div>
          {found && found.length === 0 && <span className="s" data-testid={`${c.tid}-empty`}>No folders with that name in the band&apos;s Drive.</span>}
          {(found ?? []).map((x) => (
            <div key={x.id} className="flex items-center gap-2 rounded-lg border border-line p-2" data-testid={`${c.tid}-hit-${x.name}`}>
              <span className="grid min-w-0 flex-1"><b className="truncate text-sm">{x.name}</b><span className="s">{x.ownerEmail}</span></span>
              <a className="btn ghost sm" href={x.url} target="_blank" rel="noreferrer">Open</a>
              <button type="button" className="btn acc sm" disabled={busy || x.id === f?.id} onClick={() => choose(x.id)} data-testid={`${c.tid}-choose`}>{x.id === f?.id ? "Current" : "Choose"}</button>
            </div>
          ))}
          <ErrorBox error={error} />
          <div className="card-foot"><div className="end">
            <button type="button" className="btn text" onClick={() => { setOpen(false); setQ(""); setFound(null); setError(null); }} data-testid={`${c.tid}-cancel`}>Cancel</button>
          </div></div>
        </form>
      )}
    </section>
  );
}
