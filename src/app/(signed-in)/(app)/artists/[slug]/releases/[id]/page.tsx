"use client";
import { BackLink } from "@/components/BackLink";
import { AdminOnly } from "@/components/Guard";
import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { SongSearch } from "@/components/music/SongSearch";
import { Menu } from "@/components/Menu";
import { InlineValue } from "@/components/InlineValue";
import { Dialog, ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { Tabs } from "@/components/booking/common";
import { useCollection } from "@/lib/firestore-hooks";
import { useDragReorder } from "@/lib/drag-reorder";
import { fmtLen } from "@/lib/music";
import { formatCents, projectTotals } from "@/lib/money";
import { RELEASE_KIND_LONG, releaseMeta, latestMix, mixLabel, sidesOf, totalLength, trackProgress } from "@/lib/releases";
import { ReleaseMissing, StatusPill, releaseHref, trackHref, useRelease, type ReleaseData, type ReleaseRow, type TrackRow } from "@/components/releases/common";
import { ReleaseMoney } from "@/components/releases/ReleaseMoney";
import { ReleaseFolder } from "@/components/releases/ReleaseFolder";
import { ReleaseFiles } from "@/components/releases/ReleaseFiles";
import type { Expense, Income, Payout, SetlistTemplate } from "@/schema";

/** "Mar 6, 2027". */
const fmtDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
type Tab = "tracks" | "money" | "files";

export default function ReleasePage() {
  return <AdminOnly><Suspense fallback={null}><Page /></Suspense></AdminOnly>;
}

function Page() {
  const { id } = useParams<{ id: string }>();
  const d = useRelease(id);
  if (d.loading && !d.release) return null;
  if (!d.release) return <ReleaseMissing />;
  return <ReleaseView d={d} release={d.release} />;
}

function ReleaseView({ d, release }: { d: ReleaseData; release: ReleaseRow }) {
  const { admin, tracks } = d;
  const router = useRouter();
  const raw = useSearchParams().get("tab");
  // Money is admins-only, even by URL: a member asking for it gets the tracks.
  const tab: Tab = raw === "files" ? "files" : raw === "money" && admin ? "money" : "tracks";
  const setTab = (t: Tab) => router.replace(releaseHref(release.id, t === "tracks" ? undefined : t), { scroll: false });
  const { call, error, busy } = useCommand();
  const update = async (patch: Record<string, unknown>) => !!(await call("releases.update", { id: release.id, patch }));

  const p = trackProgress(tracks);
  const n = p.total;

  return (
    <div className="sg-page" data-testid="release-page">
      <PageTitle back={<BackLink mode="back" href="/releases" label="All releases" />}
        title={admin
          ? <InlineValue testid="field-title" label="Title" kind="text" value={release.title} canEdit validate={(v) => (v.trim() ? null : "A release needs a title")}
              onSave={(v) => update({ title: v.trim() })} error={error} />
          : release.title}
        actions={admin ? (
          <Menu label="More actions" testid="release" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>}
            items={[{ key: "archive", label: "Archive release", danger: true, disabled: busy, onSelect: async () => {
              if (confirm(`Archive ${release.title}? Its tracks and release files go with it; its money project is closed, not removed.`) && (await call("releases.remove", { id: release.id }))) router.push("/releases");
            } }]} />
        ) : undefined} />

      <Tabs<Tab> testid="release-tab" value={tab} onChange={setTab}
        options={[["tracks", "Tracks"], ...(admin ? [["money", "Money"] as [Tab, string]] : []), ["files", "Files"]]} />
      <ErrorBox error={error} />

      {tab === "tracks" && <>
        <section className="card flex flex-wrap items-start gap-5">
          {release.cover?.url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={release.cover.url} alt={`${release.title} cover`} className="h-[148px] w-[148px] shrink-0 rounded-xl object-cover" data-testid="release-cover" />
            : <div role="img" aria-label="No cover yet" className="grid h-[148px] w-[148px] shrink-0 place-items-center rounded-xl border-2 border-dashed text-sm font-semibold text-muted" data-testid="release-cover">Cover</div>}
          <div className="grid min-w-0 flex-1 content-start gap-2">
            <div className="s" data-testid="release-kind">{RELEASE_KIND_LONG[release.kind]}</div>
            <div className="text-[0.9375rem]" data-testid="release-meta">{releaseMeta(release, tracks, fmtLen, fmtDate)}</div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[0.9375rem]">
              <span data-testid="release-progress">Tracked <b>{p.tracked}/{n}</b> · Mixed <b>{p.mixed}/{n}</b> · Mastered <b>{p.mastered}/{n}</b></span>
              {admin && <Spent release={release} />}
            </div>
          </div>
        </section>
        <Tracklist d={d} release={release} />
        <ReleaseDetails release={release} admin={admin} />
      </>}
      {tab === "money" && admin && <ReleaseMoney data={d} />}
      {tab === "files" && <ReleaseFiles data={d} />}
    </div>
  );
}

/** "Spent $4,212.00": the release project's expenses plus what was paid out on it. Admins only. */
function Spent({ release }: { release: ReleaseRow }) {
  const income = useCollection<Income>("income");
  const expenses = useCollection<Expense>("expenses");
  const payouts = useCollection<Payout>("payouts");
  // The release's project is never the default one, so records without a projectId never count here.
  const t = projectTotals({ projectId: release.projectId, income: income.rows ?? [], expenses: expenses.rows ?? [], payouts: payouts.rows ?? [] });
  const spent = t.outPaid + t.outOwed;
  return <span data-testid="release-spent">Spent <b>{formatCents(spent)}</b></span>;
}

function move<T>(xs: readonly T[], from: number, to: number): T[] {
  const out = [...xs];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

function Tracklist({ d, release }: { d: ReleaseData; release: ReleaseRow }) {
  const { admin, tracks, files } = d;
  const { call, error, busy } = useCommand();
  // A dragged order shows at once; once the saved tracks catch up (or the save fails) the tracks' own order shows again.
  const [order, setOrder] = useState<string[] | null>(null);
  const key = tracks.map((t) => `${t.id}:${t.position}:${t.side ?? ""}`).join(",");
  useEffect(() => setOrder(null), [key]);
  const shown = useMemo(() => {
    if (!order) return tracks;
    const byId = new Map(tracks.map((t) => [t.id, t]));
    const list = order.flatMap((x) => byId.get(x) ?? []);
    // Sides stay by position (as the server keeps them): the track now at a position takes that position's side.
    return list.length === tracks.length ? list.map((t, i) => ({ ...t, side: tracks[i].side })) : tracks;
  }, [order, tracks]);
  const dr = useDragReorder(async (from, to) => {
    const ids = move(shown.map((t) => t.id), from, to);
    setOrder(ids);
    if (!(await call("releases.tracks.reorder", { releaseId: release.id, ids }))) setOrder(null);
  });
  const groups = sidesOf(shown);
  const hasSides = groups.some((g) => g.side);
  const [panel, setPanel] = useState(false);
  const cols = admin ? 7 : 6;
  let idx = 0;

  return (
    <section className="sg-sec" aria-labelledby="tracklist-h">
      <div className="sg-sech">
        <h2 id="tracklist-h" className="sg-lbl">Tracklist <span className="font-normal normal-case tracking-normal">· {tracks.length}{tracks.length ? ` · ${fmtLen(totalLength(tracks))}` : ""}</span></h2>
        {admin && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn outline" onClick={() => setPanel(!panel)} aria-expanded={panel} disabled={tracks.length < 2} data-testid="side-break-btn">+ Side break</button>
          </div>
        )}
      </div>
      {admin && panel && <SideBreakPanel release={release} tracks={tracks} hasSides={hasSides} onDone={() => setPanel(false)} />}
      {tracks.length === 0
        ? <div className="empty" data-testid="tracklist"><span>No tracks yet. Search for a song below, or add a setlist.</span></div>
        : (
          <div className="song-tw" data-testid="tracklist">
            <table className="song-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  {admin && <th scope="col" className="w-8"><span className="sr-only">Reorder</span></th>}
                  <th scope="col" className="w-10">#</th>
                  <th scope="col">Title</th>
                  <th scope="col">Status</th>
                  <th scope="col">Latest mix</th>
                  <th scope="col" className="len">Files</th>
                  <th scope="col" className="len">Length</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, gi) => (
                  <Fragment key={`${g.side ?? ""}-${gi}`}>
                    {g.side && (
                      <tr data-testid={`side-${g.side}`}>
                        <td colSpan={cols} className="!h-10 text-sm font-bold text-muted">Side {g.side} · {fmtLen(g.lengthSec)}</td>
                      </tr>
                    )}
                    {g.tracks.map((t) => {
                      const i = idx++;
                      return (
                        <tr key={t.id} data-testid={`track-row-${t.id}`} {...(admin ? dr.row(i) : {})}>
                          {admin && <td><span className="cursor-grab select-none px-1 text-muted" title="Drag to reorder" aria-label={`Drag ${t.title} to reorder`} data-testid="track-grip" {...dr.handle(i)}>⋮⋮</span></td>}
                          <td className="tabular-nums">{i + 1}</td>
                          <td><Link href={trackHref(release.id, t.id)} className="nm" data-testid="track-title">{t.title}</Link></td>
                          <td><StatusPill status={t.status} testid="track-status" /></td>
                          <td className="whitespace-nowrap" data-testid="track-mix">{mixLabel(latestMix(files, t.id))}</td>
                          <td className="len" data-testid="track-files">{files.filter((f) => f.releaseTrackId === t.id).length}</td>
                          <td className="len">{t.lengthSec ? fmtLen(t.lengthSec) : <span className="dash">—</span>}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <p className="s">Side breaks are optional (for vinyl). Each track points at a song; titles and lengths start from the song and can differ on the release.</p>
      <ErrorBox error={error} />
      {busy && <span className="sr-only" role="status">Saving the order…</span>}
      {admin && <AddTracks d={d} release={release} sides={groups.flatMap((g) => g.side ?? [])} />}
    </section>
  );
}

function SideBreakPanel({ release, tracks, hasSides, onDone }: { release: ReleaseRow; tracks: TrackRow[]; hasSides: boolean; onDone(): void }) {
  const { call, error, busy } = useCommand();
  const options = tracks.slice(1);
  const [at, setAt] = useState(options[Math.floor(tracks.length / 2) - 1]?.id ?? options[0]?.id ?? "");
  const pick = options.some((t) => t.id === at) ? at : options[0]?.id ?? "";
  const run = async (atTrackId: string | null) => { if (await call("releases.tracks.sideBreak", { releaseId: release.id, atTrackId })) onDone(); };
  const next = hasSides ? `Side ${String.fromCharCode(65 + new Set(tracks.map((t) => t.side).filter(Boolean)).size)}` : "Side B";
  return (
    <div className="card grid gap-3" data-testid="side-break-panel">
      <label className="grid gap-1"><span className="lbl">{next} starts at track</span>
        <select className="select" value={pick} onChange={(e) => setAt(e.target.value)} data-testid="side-break-at">
          {options.map((t) => <option key={t.id} value={t.id}>{t.position} · {t.title}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn acc" disabled={busy || !pick} onClick={() => run(pick)} data-testid="side-break-submit">Add side break</button>
        {hasSides && <button type="button" className="btn ghost" disabled={busy} onClick={() => run(null)} data-testid="clear-sides">Clear sides</button>}
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

/**
 * The Tracks card's adder: one song search (the same SongSearch the rehearsal and setlist cards use). Picking a song,
 * by click or Enter, adds it as a track at once (to the end of the release, or of the side picked when there are
 * sides). "Add a setlist" is the small secondary action: it opens a dialog to pick a setlist whose songs become tracks.
 */
function AddTracks({ d, release, sides }: { d: ReleaseData; release: ReleaseRow; sides: string[] }) {
  const { call, error, busy } = useCommand();
  const [where, setWhere] = useState("");
  const [setlist, setSetlist] = useState(false);
  const onRelease = useMemo(() => d.tracks.map((t) => t.songId), [d.tracks]);
  const side = sides.includes(where) ? where : "";
  return (
    <div className="grid gap-2" data-testid="add-tracks">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[14rem] flex-1">
          <SongSearch songs={d.songs} exclude={onRelease} testid="track-song-search"
            onAdd={(songId) => { void call("releases.tracks.add", { releaseId: release.id, songIds: [songId], ...(side ? { side } : {}) }); }} />
        </div>
        {sides.length > 0 && (
          <select className="select !w-auto" aria-label="Add to" value={side} onChange={(e) => setWhere(e.target.value)} data-testid="add-to">
            <option value="">End of release</option>
            {sides.map((s) => <option key={s} value={s}>End of Side {s}</option>)}
          </select>
        )}
        <button type="button" className="btn text sm" onClick={() => setSetlist(true)} data-testid="add-setlist-btn">Add a setlist</button>
      </div>
      <ErrorBox error={error} />
      {busy && <span className="sr-only" role="status">Adding…</span>}
      <AddSetlist d={d} release={release} open={setlist} onClose={() => setSetlist(false)} side={side} />
    </div>
  );
}

function AddSetlist({ d, release, open, onClose, side }: { d: ReleaseData; release: ReleaseRow; open: boolean; onClose(): void; side: string }) {
  const { call, error, busy } = useCommand();
  const templates = (useCollection<SetlistTemplate>("setlistTemplates", { skip: !open }).rows ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const [setlistId, setSetlistId] = useState("");
  const [slPicked, setSlPicked] = useState<string[] | null>(null);
  const onRelease = useMemo(() => new Map(d.tracks.map((t) => [t.songId, t.position])), [d.tracks]);
  const songById = useMemo(() => new Map(d.songs.map((s) => [s.id, s])), [d.songs]);

  // Every open starts fresh.
  useEffect(() => { if (open) { setSetlistId(""); setSlPicked(null); } }, [open]);

  const tpl = templates.find((t) => t.id === setlistId) ?? templates[0];
  const tplSongs = useMemo(() => {
    const seen = new Set<string>();
    return (tpl?.items ?? []).flatMap((it) => (it.type === "song" && it.songId && !seen.has(it.songId) ? (seen.add(it.songId), [{ id: it.songId, title: songById.get(it.songId)?.title ?? it.title }]) : []));
  }, [tpl, songById]);
  // A setlist's songs start ticked (all but the ones already on the release).
  const slTicked = slPicked ?? tplSongs.filter((s) => !onRelease.has(s.id)).map((s) => s.id);
  const chosen = tplSongs.map((s) => s.id).filter((x) => slTicked.includes(x));
  const toggle = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  async function add() {
    const r = await call("releases.tracks.add", { releaseId: release.id, songIds: chosen, ...(side ? { side } : {}) });
    if (r) onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add a setlist" testid="add-tracks-dialog">
      {templates.length === 0 ? <div className="empty"><span>The band has no setlists yet.</span></div> : <>
        <label className="grid gap-1"><span className="lbl">Setlist</span>
          <select className="select" value={tpl?.id ?? ""} onChange={(e) => { setSetlistId(e.target.value); setSlPicked(null); }} data-testid="pick-setlist">
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <ul className="hit-list">
          {tplSongs.length === 0 && <li className="s p-3">No songs in this setlist.</li>}
          {tplSongs.map((s) => {
            const there = onRelease.has(s.id);
            return (
              <li key={s.id}>
                <label className={`hit-row !cursor-pointer${there ? " text-muted" : ""}`}>
                  <span className="flex min-w-0 items-center gap-3">
                    <input type="checkbox" checked={there || slTicked.includes(s.id)} disabled={there} onChange={() => setSlPicked(toggle(slTicked, s.id))} data-testid={`pick-song-${s.id}`} />
                    <span className="truncate font-semibold">{s.title}</span>
                  </span>
                  {there && <span className="s">on release, track {onRelease.get(s.id)}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      </>}
      <span className="s">Pick a setlist and untick songs; its order becomes the tracklist. Breaks and notes are skipped.</span>
      <ErrorBox error={error} />
      <div className="dlg-foot">
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn acc" disabled={busy || chosen.length === 0} onClick={add} data-testid="add-tracks-submit">Add {chosen.length} track{chosen.length === 1 ? "" : "s"}</button>
      </div>
    </Dialog>
  );
}

function ReleaseDetails({ release, admin }: { release: ReleaseRow; admin: boolean }) {
  const { call, error, busy } = useCommand();
  const save = async (patch: Record<string, unknown>) => !!(await call("releases.update", { id: release.id, patch }));
  const field = (k: "distributor" | "upc" | "formats", label: string, empty: string) => (
    <div><dt className="lbl">{label}</dt><dd>
      {admin
        ? <InlineValue testid={`field-${k}`} label={label} kind="text" value={release[k] ?? ""} canEdit emptyLabel={k === "upc" ? "Not yet" : "Add…"} onSave={(v) => save({ [k]: v.trim() || null })} error={error} />
        : <span className={release[k] ? undefined : "d-muted"} data-testid={`field-${k}`}>{release[k] || empty}</span>}
    </dd></div>
  );
  return (
    <section className="sg-sec" aria-labelledby="release-h">
      <h2 id="release-h" className="sg-lbl">Release details</h2>
      <dl className="card sg-dl" data-testid="release-details">
        {field("distributor", "Distributor", "Not yet")}
        {field("upc", "UPC", "Not yet")}
        {field("formats", "Formats", "Not set")}
        <div><dt className="lbl">Drive folder</dt><dd>
          <ReleaseFolder release={release} admin={admin} />
        </dd></div>
      </dl>
      <ErrorBox error={error} />
    </section>
  );
}
