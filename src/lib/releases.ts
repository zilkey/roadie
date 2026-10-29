/** Pure helpers for releases and their tracks (shared by the server commands, the pages and tests). */
import type { ReleaseKind, ReleaseStatus, TrackStatus } from "@/schema/releases";
import type { FileKind } from "./music";

export const RELEASE_KIND_LABEL: Record<ReleaseKind, string> = { album: "Album", ep: "EP", single: "Single" };
/** What the index and header say about a kind ("Full-length release"). */
export const RELEASE_KIND_LONG: Record<ReleaseKind, string> = { album: "Full-length album", ep: "EP", single: "Single" };
export const RELEASE_KINDS: ReleaseKind[] = ["album", "ep", "single"];
export const RELEASE_STATUS_LABEL: Record<ReleaseStatus, string> = { planning: "Planning", recording: "Recording", mixing: "Mixing", mastering: "Mastering", released: "Released" };
export const RELEASE_STATUSES: ReleaseStatus[] = ["planning", "recording", "mixing", "mastering", "released"];

export const TRACK_STATUS_LABEL: Record<TrackStatus, string> = { tracking: "Tracking", overdubs: "Overdubs", mixing: "Mixing", mixed: "Mixed", mastered: "Mastered" };
/** In the order a track moves through them. */
export const TRACK_STATUSES: TrackStatus[] = ["tracking", "overdubs", "mixing", "mixed", "mastered"];
const RANK: Record<TrackStatus, number> = { tracking: 0, overdubs: 1, mixing: 2, mixed: 3, mastered: 4 };
/** Has the track got at least this far? */
export const trackReached = (status: TrackStatus, step: TrackStatus) => RANK[status] >= RANK[step];

/** The file kinds that live on the release itself, in the order the Files tab shows them, with what each group is for. */
export const RELEASE_FILE_GROUPS: { kind: FileKind; label: string; hint: string }[] = [
  { kind: "artwork", label: "Artwork", hint: "Cover, back, inserts, labels" },
  { kind: "master", label: "Release masters", hint: "The full-release masters and the CD image" },
  { kind: "liner", label: "Liner notes and credits", hint: "Lyrics booklet, thank-yous, full credits" },
  { kind: "promo", label: "Promo", hint: "One-sheet, press photos, bio, video" },
];
/** The file kinds a track's files come in, for the kind picker. */
export const TRACK_FILE_KINDS: FileKind[] = ["mix", "master", "stems", "session", "other"];
export const RELEASE_FILE_KINDS: FileKind[] = RELEASE_FILE_GROUPS.map((g) => g.kind);

export interface TrackLike { id: string; position: number; side?: string; songId: string; title: string; status: TrackStatus; lengthSec?: number }
export interface ReleaseFileLike { id: string; kind: string; title: string; releaseId?: string; releaseTrackId?: string; version?: number; approved?: boolean; notes?: unknown[] }

/** Tracks in release order (position; ties by id, so a list read back is stable). */
export const sortTracks = <T extends { position: number; id: string }>(tracks: readonly T[]) => [...tracks].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

/** Tracks grouped by side, in order. One group with `side` undefined when the release has no side breaks. */
export function sidesOf<T extends { side?: string; lengthSec?: number }>(tracks: readonly T[]): { side?: string; tracks: T[]; lengthSec: number }[] {
  const out: { side?: string; tracks: T[]; lengthSec: number }[] = [];
  for (const t of tracks) {
    const last = out[out.length - 1];
    if (last && last.side === t.side) { last.tracks.push(t); last.lengthSec += t.lengthSec ?? 0; }
    else out.push({ side: t.side, tracks: [t], lengthSec: t.lengthSec ?? 0 });
  }
  return out;
}
/** Side letters for tracks split at `breaks` (indexes, 0-based, where a new side starts): A up to the first break, then B... */
export function sidesFor(count: number, breaks: readonly number[]): (string | undefined)[] {
  const starts = [...new Set(breaks.filter((b) => b > 0 && b < count))].sort((a, b) => a - b);
  if (!starts.length) return Array.from({ length: count }, () => undefined);
  const out: (string | undefined)[] = [];
  let side = 0;
  for (let i = 0; i < count; i++) { if (starts.includes(i)) side++; out.push(String.fromCharCode(65 + side)); }
  return out;
}

export const totalLength = (tracks: readonly { lengthSec?: number }[]) => tracks.reduce((n, t) => n + (t.lengthSec ?? 0), 0);

/** How far the record is: every track counts, by how far along it is. */
export function trackProgress(tracks: readonly { status: TrackStatus }[]) {
  const n = (step: TrackStatus) => tracks.filter((t) => trackReached(t.status, step)).length;
  return { total: tracks.length, tracked: n("overdubs"), mixed: n("mixed"), mastered: n("mastered") };
}

/** "v4" from "Glass Coast v4.wav" or "mix_v2_final"; undefined when the name has no version. */
export function guessVersion(name: string): number | undefined {
  const m = /(?:^|[\s_.(-])v(?:er(?:sion)?)?[ _.-]?(\d{1,3})(?=$|[\s_.)-])/i.exec(name);
  return m ? Number(m[1]) : undefined;
}
export const fmtVersion = (v?: number) => (v ? `v${v}` : "");

/** Best guess at what a release file is from its name and type: masters, mixes, stems, session folders, artwork, liner notes, promo. */
export function guessReleaseKind(name: string, mime?: string, onTrack = false): FileKind {
  const n = name.toLowerCase();
  const image = !!mime && mime.startsWith("image/");
  if (/\bmaster(?:ed|s)?\b/.test(n)) return "master";
  if (/\bstems?\b/.test(n)) return "stems";
  if (/\bsession\b|\bmultitrack|\.ptx$|\.logicx$|\.als$/.test(n)) return "session";
  if (/\bmix(?:es|down)?\b/.test(n)) return "mix";
  if (/\bcover\b|\bartwork\b|\bart\b|\bback\b|\binsert|\blabel\b/.test(n) || image) return "artwork";
  if (/\bliner|\bcredits?\b|\bbooklet|\blyrics\b|\bthank/.test(n)) return "liner";
  if (/one-?sheet|\bpress\b|\bbio\b|\bpromo|\bphoto/.test(n)) return "promo";
  if (onTrack && mime?.startsWith("audio/")) return "mix";
  if (onTrack) return "other";
  return mime?.startsWith("audio/") ? "master" : "other";
}

/** The newest mix on a track (highest version, then newest title) and how it reads: "v4 · approved", "v1 · 3 notes", or "—". */
export function latestMix<F extends ReleaseFileLike>(files: readonly F[], trackId: string): F | undefined {
  return files.filter((f) => f.releaseTrackId === trackId && f.kind === "mix").sort((a, b) => (b.version ?? 0) - (a.version ?? 0) || a.title.localeCompare(b.title))[0];
}
export function mixLabel(f?: ReleaseFileLike): string {
  if (!f) return "—";
  const notes = f.notes?.length ?? 0;
  return [fmtVersion(f.version) || f.title, f.approved ? "approved" : notes ? `${notes} note${notes === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
}

/** What the header says: "10 tracks · 41:20 · Target release Mar 6". */
export function releaseMeta(a: { releaseDate?: string; status: ReleaseStatus }, tracks: readonly { lengthSec?: number }[], fmtLen: (s: number) => string, fmtDate: (d: string) => string): string {
  const n = tracks.length;
  const len = totalLength(tracks);
  return [`${n} track${n === 1 ? "" : "s"}`, len ? fmtLen(len) : null, a.releaseDate ? `${a.status === "released" ? "Released" : "Target release"} ${fmtDate(a.releaseDate)}` : null].filter(Boolean).join(" · ");
}
