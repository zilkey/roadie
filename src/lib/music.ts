/** Pure helpers for the Music tab (shared by server commands, UI and tests). */

export const MIME_GDOC = "application/vnd.google-apps.document";
export const MIME_WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export type MimeGroup = "audio" | "video" | "doc" | "pdf" | "other";

export function mimeGroup(mime?: string): MimeGroup {
  if (!mime) return "other";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === MIME_GDOC || mime === MIME_WORD || mime === "application/msword") return "doc";
  if (mime === "application/pdf") return "pdf";
  return "other";
}
/** Drive search only offers audio, video, Docs and Word files. */
export const isAttachable = (mime?: string) => ["audio", "video", "doc"].includes(mimeGroup(mime));
export const MIME_ICON: Record<MimeGroup, string> = { audio: "♪", video: "▶", doc: "▤", pdf: "▤", other: "▢" };

export type FileKind = "chart" | "demo" | "rehearsal" | "recording" | "lyrics" | "stems" | "other";
export const KIND_ORDER: FileKind[] = ["chart", "demo", "recording", "rehearsal", "lyrics", "stems", "other"];
export const KIND_LABEL: Record<FileKind, string> = {
  chart: "Charts", demo: "Demos", recording: "Recordings", rehearsal: "Rehearsal takes", lyrics: "Lyrics", stems: "Stems", other: "Other",
};

/** Best guess at what a Drive file is from its name and type. */
export function guessKind(name: string, mime?: string): FileKind {
  const n = name.toLowerCase();
  if (/\bchart\b/.test(n)) return "chart";
  if (/lyric/.test(n)) return "lyrics";
  if (/rehearsal/.test(n)) return "rehearsal";
  if (/\bstems?\b/.test(n)) return "stems";
  if (/\bdemo\b/.test(n)) return "demo";
  const g = mimeGroup(mime);
  if (g === "video") return "recording";
  if (/\blive\b/.test(n)) return "recording";
  if (g === "audio") return "demo";
  return "other";
}

/** "Glass Coast chart F#m.docx" -> "F#m". Looks for a key right after the word chart. */
export function guessKey(name: string): string | undefined {
  const m = /\bchart\s+([A-G][#b]?m?)(?=[\s.()_-]|$)/i.exec(name);
  if (!m) return undefined;
  const k = m[1];
  return k[0].toUpperCase() + k.slice(1);
}

/** m:ss for seconds. */
export const fmtLen = (sec?: number | null) => (sec == null ? "" : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`);
/** "3:52" or "232" -> seconds; undefined if blank or invalid. */
export function parseLen(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const m = /^(\d+):([0-5]?\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d+$/.test(t) ? Number(t) : undefined;
}

export const setlistTotal = (items: { lengthSec?: number }[]) => items.reduce((n, i) => n + (i.lengthSec ?? 0), 0);
/** Positive when under the set length, negative when over. */
export const setlistSlack = (totalSec: number, setLengthSec?: number) => (setLengthSec ? setLengthSec - totalSec : undefined);

export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/**
 * How to show a file. A direct media URL (by extension) plays in an audio/video tag; a Drive "view" link
 * plays in Drive's embedded preview; anything else just opens the link.
 */
export function playerFor(f: { url: string; mimeType?: string }): { mode: "audio" | "video" | "embed" | "link"; src: string } {
  const g = mimeGroup(f.mimeType);
  if (g !== "audio" && g !== "video") return { mode: "link", src: f.url };
  let u: URL | null = null;
  try { u = new URL(f.url); } catch { /* not a URL */ }
  if (!u) return { mode: "link", src: f.url };
  const drive = /^\/file\/d\/([^/]+)/.exec(u.pathname);
  if (u.hostname === "drive.google.com" && drive) return { mode: "embed", src: `https://drive.google.com/file/d/${drive[1]}/preview` };
  if (/\.(mp3|m4a|wav|ogg|aac|flac|mp4|webm|mov)$/i.test(u.pathname)) return { mode: g, src: f.url };
  return { mode: "link", src: f.url };
}

/** Latest rehearsal date (YYYY-MM-DD) that ran each song. */
export function lastRehearsed(rehearsals: { date: string; songs: { songId: string }[] }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rehearsals) for (const s of r.songs) if (!out[s.songId] || out[s.songId] < r.date) out[s.songId] = r.date;
  return out;
}

export function daysAgoLabel(date: string, today: string): string {
  const d = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(date + "T00:00:00Z")) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
