/**
 * A setlist's charts as one PDF: each song's Google Doc exported by Google (so tables and fonts are the doc's own), one page per
 * song in set order. A doc with several tabs gives one page per tab; a tab longer than a page gives its first page only. A song's
 * alternates follow it. The PDF is saved in "Setlists" inside the Charts folder, named after the show ("{date} {venue}") or the
 * template, and saved over when it is made again.
 */
import { PDFDocument } from "pdf-lib";
import { MIME_GDOC } from "@/lib/music";
import type { Doc } from "./db";
import type { DriveFile, DriveService } from "./integrations";
import { IntegrationError } from "./integrations/http";
import { findOrMakeFolder } from "./driveFolders";
import { parseGoogleDoc } from "./docText";

export const SETLISTS_FOLDER = "Setlists";
const MIME_PDF = "application/pdf";

interface Item { type?: string; songId?: string; title: string; key?: string; alts?: { songId?: string; title: string; key?: string }[] }
export interface PdfPage { title: string; tab?: string; alt?: boolean }
export interface PdfSkipped { title: string; reason: string; alt?: boolean }
export interface SetlistPdf { bytes: Uint8Array; pages: PdfPage[]; skipped: PdfSkipped[] }

const norm = (k?: string) => (k ?? "").trim().toLowerCase();

/**
 * The one file that is the song's chart: a Google Doc before a PDF, a chart before lyrics, the chart in the setlist's key before
 * the others, the band chart before a "lyrics" or part-specific one (the shorter title). Null when the song has neither.
 */
export function chartFor(files: Doc[], songId: string, key?: string): Doc | null {
  const mine = files.filter((f) => f.songId === songId && f.driveFileId && (f.kind === "chart" || f.kind === "lyrics") && (f.mimeType === MIME_GDOC || f.mimeType === MIME_PDF));
  const rank = (f: Doc) => [
    f.mimeType === MIME_GDOC ? 0 : 1,
    f.kind === "chart" ? 0 : 1,
    key && norm(f.key as string) === norm(key) ? 0 : 1,
    /lyric/i.test(f.title as string) ? 1 : 0,
    (f.title as string).length,
  ];
  const cmp = (a: Doc, b: Doc) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return String(a.title).localeCompare(String(b.title)); };
  return mine.sort(cmp)[0] ?? null;
}

/** The pages one chart gives: [tab title, PDF bytes] each. Only the first page of each PDF is used. */
async function chartPdfs(drive: DriveService, file: Doc): Promise<{ tab?: string; bytes: Uint8Array }[]> {
  const id = file.driveFileId as string;
  if (file.mimeType === MIME_PDF) return [{ bytes: new Uint8Array(await (await drive.download(id)).arrayBuffer()) }];
  let tabs: { id: string; title: string }[] = [];
  try { tabs = parseGoogleDoc(await drive.document(id)).tabs; } catch (e) { if (!(e instanceof IntegrationError)) throw e; }
  if (tabs.length > 1) {
    try {
      return await Promise.all(tabs.map(async (t) => ({ tab: t.title, bytes: await drive.exportPdf(id, t.id) })));
    } catch (e) {
      if (!(e instanceof IntegrationError)) throw e; // Google wouldn't export a tab on its own: the whole doc's first page is still the chart
    }
  }
  return [{ bytes: await drive.exportPdf(id) }];
}

const why = (e: unknown) => e instanceof IntegrationError && (e.status === 403 || e.status === 404)
  ? "The band's Google account can't open its chart"
  : `Its chart couldn't be read (${(e as Error).message})`;

/** Run `fn` over `items`, `n` at a time, results in order. */
async function pooled<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}

export async function buildSetlistPdf(drive: DriveService, items: Item[], files: Doc[], title: string): Promise<SetlistPdf> {
  const entries = items.filter((i) => i.type !== "break").flatMap((i) => [
    { songId: i.songId, title: i.title, key: i.key, alt: false },
    ...(i.alts ?? []).map((a) => ({ songId: a.songId, title: a.title, key: a.key, alt: true })),
  ]);
  const got = await pooled(entries, 4, async (e) => {
    const file = e.songId ? chartFor(files, e.songId, e.key) : null;
    if (!file) return { e, reason: e.songId ? "No Google Doc or PDF chart" : "Not a song in the library" };
    try { return { e, parts: await chartPdfs(drive, file) }; } catch (err) { return { e, reason: why(err) }; }
  });
  const out = await PDFDocument.create();
  out.setTitle(title);
  const pages: PdfPage[] = [], skipped: PdfSkipped[] = [];
  for (const g of got) {
    const alt = g.e.alt ? { alt: true as const } : {};
    if (!g.parts) { skipped.push({ title: g.e.title, reason: g.reason!, ...alt }); continue; }
    let added = 0;
    for (const part of g.parts) {
      try {
        const src = await PDFDocument.load(part.bytes, { ignoreEncryption: true });
        if (!src.getPageCount()) continue;
        const [page] = await out.copyPages(src, [0]);
        out.addPage(page);
        pages.push({ title: g.e.title, ...(part.tab ? { tab: part.tab } : {}), ...alt });
        added++;
      } catch { /* not a PDF we can read: counted below */ }
    }
    if (!added) skipped.push({ title: g.e.title, reason: "Its chart couldn't be read as a PDF", ...alt });
  }
  return { bytes: pages.length ? await out.save() : new Uint8Array(), pages, skipped };
}

/** Save the PDF as `name` in Charts/Setlists (made and shared with the band the first time), over the one already there by that name. */
export async function saveSetlistPdf(drive: DriveService, chartsFolderId: string, name: string, bytes: Uint8Array, emails: string[]): Promise<{ file: DriveFile; folder: DriveFile }> {
  const { folder } = await findOrMakeFolder(drive, chartsFolderId, SETLISTS_FOLDER, { emails });
  const data = new Blob([bytes as BlobPart], { type: MIME_PDF });
  const there = (await drive.search({ parent: folder.id, mimeType: MIME_PDF })).find((f) => f.name === name);
  const file = there ? await drive.replace(there.id, { mimeType: MIME_PDF, data }) : await drive.upload({ name, mimeType: MIME_PDF, parentId: folder.id, data });
  return { file, folder };
}
