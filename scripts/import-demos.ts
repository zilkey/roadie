/**
 * One-time linking of the band's Demos folder in Drive to the songs it belongs to, from the snapshot in
 * .booking-kit/demos.json (gitignored, public repo).
 *   tsx scripts/import-demos.ts [--dry-run] [--yes] [--artist=<slug>] [--report=<file.json>]
 *
 * The snapshot is captured through the Google Drive MCP connector, not by a script (the repo has no Google credentials
 * of its own): list `parentId = '<Demos>'`, then `parentId` of each subfolder, and write one entry per file with its
 * id, name, mimeType, size and the name of the subfolder it sits in (null at the top level).
 *
 * The Demos folder holds two things:
 *   - loose files at the top level: demos, drum arrangements, rehearsal (practice) tracks, live videos. About half were
 *     already linked from the Songs tab's Demo column by scripts/import-song-list.ts; the rest were never linked.
 *   - one subfolder per rehearsal, named by its date ("2026-09-29 - Rehearsal"), holding that night's recordings. Each
 *     becomes a file on its song AND on that rehearsal (songId + rehearsalId), so it shows on both pages. The
 *     rehearsals already exist (scripts/import-rehearsal-history.ts, rehearsal-<date>); this never creates one.
 *
 * Which song a file belongs to is the one thing a file name can't be trusted to say ("Let Love - Intro", "I'm Not Gonna
 * Wait", "Other Side - 206-10-04"), so it is written down per file in SONG_OF below, where it can be checked by eye,
 * rather than guessed by fuzzy matching. A file the table doesn't name is reported, never guessed.
 *
 * What it changes on files already linked: only a missing mimeType (the import-song-list docs have none, so the Songs
 * list never showed their ♪). Kind and title are the band's to change in the UI and are left alone. A file already on a
 * DIFFERENT song is reported and left there. Owner, band-folder and sharing are left to the song page's sharing check
 * (files.check), which reads Drive itself.
 *
 * Fixed ids (songfile-<songId>-<driveFileId>), and dedupe on driveFileId, so a re-run reports everything unchanged.
 * All writes go through db.ts with via "import" and one runId (Admin → History can undo it). Real Firestore needs --yes.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentData } from "firebase-admin/firestore";
import { run, db, type Writer } from "../src/server/db";
import { importCtx, newRunId } from "../src/server/ctx";
import { slug } from "../src/schema/normalize";
import { guessKind } from "../src/lib/music";
import { formatSurvey, note, tally, type Note, type Survey } from "./survey";

export interface DemosSnapshot {
  source: string;
  folderId: string;
  folderName: string;
  fetchedAt: string;
  subfolders: { id: string; name: string }[];
  files: { id: string; name: string; mimeType: string; size: number; folder: string | null }[];
}

/** Every file in the Demos folder, by its Drive name, and the song (by title, as the app has it) it belongs to. */
const SONG_OF: Record<string, string> = {
  // Top level
  "Animal - Rehearsal Track.m4a": "Animal",
  "Back to Oz - Production Demo.mp3": "Back to Oz",
  "Back to Oz - Rehearsal Track.m4a": "Back to Oz",
  "Broken Drum Arrangement.mp3": "Broken",
  "Broken Version 2 - Take 2.m4a": "Broken",
  "Digging For The Diamond - 6.7.26 - Production Mix 1 - BPM 103 - No Pre Vocals (1).wav": "Digging for the Diamond",
  "Great Migration - 2026-05-04.mp3": "Great Migration",
  "Happy We're Still Fighting - Mix 3 - 9.18.26.wav": "Happy We're Still Fighting",
  "High Road - Rehearsal Track.m4a": "High Road",
  "Joy Is My Revolution - Ingrid Avison - Demo.mp3": "Joy is my Revolution",
  "Joy is my Revolution - Rehearsal Track.m4a": "Joy is my Revolution",
  "Let Love Second Pass.m4a": "Let Love Tell Us",
  "Let Love Tell Us - Ingrid Avison - Demo.mp3": "Let Love Tell Us",
  "Little Rabbit - Rehearsal Track.m4a": "Little Rabbit",
  // "Run Little Rabbit" is not a song title in the app; Little Rabbit is the only song it can be.
  "Run Little Rabbit - Rehearsal Track.mp3": "Little Rabbit",
  "Mother - 2026-05-04.mp3": "Mother",
  "Not Gonna Wait for You - Drum Arrangement.mp3": "Not Gonna Wait for You",
  "Not Gonna Wait For You - Voice Memo.m4a": "Not Gonna Wait for You",
  "Not Gonna Wait For You - verse chorus.m4a": "Not Gonna Wait for You",
  "Pace of Trust.mp4": "Pace of Trust",
  "Ruined - Drums Arrangements.mp3": "Ruined",
  "Ruined.mp4": "Ruined",
  "So Goddamn Blue.mp3": "So Goddamn Blue",
  "The Other Side.mp3": "The Otherside",
  "Twisted Take.wav": "Twisted Take",
  "What a Time to Live - Demo.mp3": "What a Time to Live",
  "You and Me.wav": "You and Me",
  // 2026-09-29 - Rehearsal
  "Animal - 2026-09-29.m4a": "Animal",
  "Back to Oz - 2026-09-29.m4a": "Back to Oz",
  "High Road - 2026-09-29.m4a": "High Road",
  "Joy is my Revolution - 2026-09-29.m4a": "Joy is my Revolution",
  "Run Down and Ragged - 2026-09-29.m4a": "Run Down and Ragged",
  "Take it Easy - 2029-09-29.m4a": "Take It Easy",
  // 2026-10-04 Rehearsal
  "Let Love - 2026-10-04.m4a": "Let Love Tell Us",
  "Let Love - Intro.m4a": "Let Love Tell Us",
  "Other Side - 206-10-04 (not final tempo).m4a": "The Otherside",
  "Otherside Ending - 118bpm - 2026-10-04.m4a": "The Otherside",
  "So Goddamn Blue - 2026-10-04.m4a": "So Goddamn Blue",
  "Time Traveling Cowboy - 2026-10-04.m4a": "Time Traveling Cowboy",
  "Time Traveling Cowboy Ending - 2026-10-04.m4a": "Time Traveling Cowboy",
  // 2026-10-13
  "Broken - 96.m4a": "Broken",
  "Helpless.m4a": "Helpless",
  "I’m Not Gonna Wait.m4a": "Not Gonna Wait for You",
  "Ruined - 116.m4a": "Ruined",
  "Ruined 2nd Half.m4a": "Ruined",
  "Ruined Pre Chorus.m4a": "Ruined",
  "You and Me - 83.m4a": "You and Me",
};

/** A subfolder named for a date is that rehearsal's recordings. */
const rehearsalDate = (folder: string | null) => (folder ? /^(\d{4}-\d{2}-\d{2})\b/.exec(folder)?.[1] : undefined);

const viewUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

export interface DemosReport {
  project: string; dryRun: boolean; runId: string;
  source: string; fetchedAt: string;
  artist?: { id: string; slug: string; name: string };
  rows: {
    name: string; driveFileId: string; folder: string | null;
    song?: string; songId?: string; rehearsalId?: string; kind?: string;
    fileId?: string;
    action?: "created" | "filled" | "unchanged" | "skipped";
    issues: string[];
  }[];
  /** Drive files on songs, other than charts, that aren't in the Demos folder: not this import's, said so they aren't missed. */
  elsewhere: { songId: string; title: string; driveFileId: string }[];
  /** Rehearsals whose recordings name a song the rehearsal's own song list doesn't have. */
  notInRun: { rehearsalId: string; songs: string[] }[];
  /** Files of identical size: likely the same recording twice. */
  sameSize: { size: number; names: string[] }[];
}

export async function importDemos(opts: { dryRun?: boolean; artist?: string; snapshot?: DemosSnapshot } = {}): Promise<DemosReport> {
  const snap = opts.snapshot
    ?? (JSON.parse(readFileSync(join(process.cwd(), ".booking-kit", "demos.json"), "utf8")) as DemosSnapshot);
  const runId = newRunId();
  const report: DemosReport = {
    project: process.env.GCLOUD_PROJECT ?? "", dryRun: !!opts.dryRun, runId,
    source: snap.source, fetchedAt: snap.fetchedAt, rows: [], elsewhere: [], notInRun: [], sameSize: [],
  };

  const artists = await db.list("artists");
  const artist = opts.artist ? artists.find((a) => a.slug === opts.artist) : artists.length === 1 ? artists[0] : undefined;
  if (!artist) return report;
  report.artist = { id: artist.id, slug: artist.slug as string, name: artist.name as string };
  const ctx = importCtx("import-demos", runId, artist.id);
  const overlay = new Map<string, DocumentData | null>();
  const unit = <T>(fn: (w: Writer) => Promise<T>) => run(ctx, fn, opts.dryRun ? { dryRun: true, overlay } : {});

  const bySize = new Map<number, string[]>();
  for (const f of snap.files) bySize.set(f.size, [...(bySize.get(f.size) ?? []), f.name]);
  report.sameSize = [...bySize.entries()].filter(([, names]) => names.length > 1).map(([size, names]) => ({ size, names }));

  const recorded = new Map<string, Set<string>>();
  for (const f of snap.files) {
    const issues: string[] = [];
    const out: DemosReport["rows"][number] = { name: f.name, driveFileId: f.id, folder: f.folder, issues };
    report.rows.push(out);

    const song = SONG_OF[f.name];
    if (!song) { out.action = "skipped"; issues.push("not in the file-to-song table; add it to SONG_OF"); continue; }
    const date = rehearsalDate(f.folder);
    if (f.folder && !date) { out.action = "skipped"; issues.push(`in subfolder "${f.folder}", whose name isn't a date`); continue; }
    out.song = song;
    out.songId = `song-${slug(song)}`;
    out.rehearsalId = date ? `rehearsal-${date}` : undefined;
    out.kind = date ? "rehearsal" : guessKind(f.name, f.mimeType);
    if (out.rehearsalId) recorded.set(out.rehearsalId, (recorded.get(out.rehearsalId) ?? new Set()).add(out.songId));

    await unit(async (w) => {
      const s = await w.get("songs", out.songId!);
      if (!s || s.deletedAt) { out.action = "skipped"; issues.push(`no song ${out.songId} ("${song}")`); return; }
      if (out.rehearsalId) {
        const r = await w.get("rehearsals", out.rehearsalId);
        if (!r || r.deletedAt) { out.action = "skipped"; issues.push(`no rehearsal ${out.rehearsalId}`); return; }
      }
      const have = (await w.query("files", (q) => q.where("driveFileId", "==", f.id), { pending: true }))
        // pending brings in every file this dry run has touched, unfiltered (see Writer.query), so narrow it here.
        .filter((d) => d.driveFileId === f.id && !d.deletedAt);
      const mine = have.find((d) => d.songId === out.songId && (d.rehearsalId ?? undefined) === out.rehearsalId);
      if (mine) {
        out.fileId = mine.id;
        if (mine.mimeType) { out.action = "unchanged"; return; }
        out.action = "filled";
        await w.update("files", mine.id, { mimeType: f.mimeType });
        return;
      }
      if (have.length) {
        out.action = "skipped";
        for (const d of have) issues.push(`already linked to ${d.songId as string}${d.rehearsalId ? ` / ${d.rehearsalId as string}` : ""} as "${d.title as string}", not ${out.songId}${out.rehearsalId ? ` / ${out.rehearsalId}` : ""}; left there`);
        return;
      }
      out.fileId = `songfile-${out.songId}-${f.id}`;
      out.action = "created";
      await w.create("files", {
        kind: out.kind, title: f.name, songId: out.songId, ...(out.rehearsalId ? { rehearsalId: out.rehearsalId } : {}),
        driveFileId: f.id, provider: "drive", url: viewUrl(f.id), mimeType: f.mimeType, checkedAt: new Date(),
      }, { id: out.fileId });
    });
  }

  for (const [rehearsalId, songIds] of recorded) {
    const r = await db.get("rehearsals", rehearsalId);
    if (!r) continue;
    const played = new Set(((r.songs as { songId?: string }[] | undefined) ?? []).map((x) => x.songId));
    const missing = [...songIds].filter((id) => !played.has(id));
    if (missing.length) report.notInRun.push({ rehearsalId, songs: missing });
  }

  const inSnap = new Set(snap.files.map((f) => f.id));
  for (const d of await db.list("files")) {
    if (d.deletedAt || !d.songId || !d.driveFileId || d.kind === "chart" || inSnap.has(d.driveFileId as string)) continue;
    report.elsewhere.push({ songId: d.songId as string, title: d.title as string, driveFileId: d.driveFileId as string });
  }
  return report;
}

export function demosSurvey(r: DemosReport): Survey {
  const notes: Note[] = [];
  if (!r.artist) notes.push(note("unclean", "NO ARTIST: nothing to import into", "", "pass --artist=<slug>"));
  for (const x of r.rows) {
    const where = `${x.folder ? `${x.folder}/` : ""}${x.name}`;
    for (const issue of x.issues) {
      const bucket = /already linked/.test(issue) ? "decide" : /SONG_OF|isn't a date/.test(issue) ? "decide" : "unclean";
      const reason = issue.replace(/"[^"]*"/g, "a value").replace(/\b(song|rehearsal)-[\w-]+/g, "$1-…").trim();
      notes.push(note(bucket, reason, where, issue));
    }
    if (x.name === "Run Little Rabbit - Rehearsal Track.mp3" && x.action !== "skipped") {
      notes.push(note("decide", "the file name isn't a song title; the table names the song", where, `→ ${x.song}`));
    }
  }
  for (const g of r.sameSize) {
    notes.push(note("decide", "files of identical size: probably one recording twice (both are linked)", g.names.join(" = "), `${g.size} bytes`));
  }
  for (const n of r.notInRun) {
    notes.push(note("deferred", "recorded at a rehearsal whose song list doesn't include the song (song list left as is)", n.rehearsalId, n.songs.join(", ")));
  }
  for (const e of r.elsewhere) {
    notes.push(note("deferred", "a Drive file on a song that isn't in the Demos folder (left as is)", e.songId, `${e.title} (${e.driveFileId})`));
  }
  const linked = r.rows.filter((x) => x.action && x.action !== "skipped");
  return {
    title: "Demos", project: r.project, dryRun: r.dryRun, runId: r.runId,
    source: `${r.rows.length} files from the Demos folder, ${r.rows.filter((x) => x.folder).length} of them in rehearsal subfolders (captured ${r.fetchedAt})`,
    clean: tally(linked.map((x) => ({ collection: "files", action: x.action! }))),
    notes,
    totals: {
      artist: r.artist ? `${r.artist.name} (${r.artist.slug})` : "NONE -- nothing can be imported",
      "songs with a Demos file": new Set(linked.map((x) => x.songId)).size,
      "rehearsal recordings": linked.filter((x) => x.rehearsalId).length,
      "by kind": Object.entries(linked.reduce<Record<string, number>>((a, x) => ({ ...a, [x.kind!]: (a[x.kind!] ?? 0) + 1 }), {}))
        .map(([k, n]) => `${k} ${n}`).join(", "),
    },
  };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await importDemos({ dryRun: flag("dry-run"), artist: arg("artist") });
  console.log(formatSurvey(demosSurvey(r)));
  const out = arg("report");
  if (out) { writeFileSync(out, JSON.stringify({ ...r, survey: demosSurvey(r) }, null, 2) + "\n"); console.log(`Report: ${out}`); }
  if (!r.dryRun && r.rows.length) console.log(`\nRun ${r.runId} -- undo it from Admin → History.`);
  if (!r.artist) throw new Error("No artist found, so nothing was imported.");
}

if (process.argv[1]?.endsWith("import-demos.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
