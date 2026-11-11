/**
 * A Google Doc for the song and rehearsal pages (#18): its tabs, tables, bold and italic, read from the Docs API (documents.get
 * with includeTabsContent) into the small DocContent model, never as HTML. Cached on the file record (docContent, plus its plain
 * text in docText) with the doc's modifiedTime (docModifiedTime): a view asks Drive for the doc's metadata and re-reads only
 * when that changed. If the Docs API refuses (not enabled, a hiccup), Drive's text/plain export is the fallback: one tab of
 * plain paragraphs, as before.
 */
import type { DriveService } from "./integrations";
import { IntegrationError } from "./integrations/http";
import { docContent as docContentSchema, docContentFromText, docContentText, type DocBlock, type DocContent, type DocPara, type DocRun, type DocTab } from "@/schema/docContent";

export type DocTextResult =
  /** `changed`: the cache on the file record is out of date; write content, text and modifiedTime back. */
  | { status: "ok"; content: DocContent; text: string; modifiedTime?: string; changed: boolean }
  /** The band's Google account can't read the doc (Drive said 403 or 404). */
  | { status: "noAccess" }
  /** Drive didn't answer (or answered something else): the cached content, if any, is all there is. */
  | { status: "error"; message: string };

/** Drive's text/plain export starts with a byte order mark and ends lines with CRLF. */
export const cleanDocText = (t: string) => t.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");

const noAccess = (e: unknown) => e instanceof IntegrationError && (e.status === 403 || e.status === 404);

// ---------- the Docs API's document, the parts read here ----------

interface GTextStyle { bold?: boolean; italic?: boolean }
interface GParagraphElement {
  textRun?: { content?: string; textStyle?: GTextStyle };
  person?: { personProperties?: { name?: string; email?: string }; textStyle?: GTextStyle };
  richLink?: { richLinkProperties?: { title?: string }; textStyle?: GTextStyle };
  dateElement?: { dateElementProperties?: { displayText?: string }; textStyle?: GTextStyle };
}
interface GParagraph { elements?: GParagraphElement[]; bullet?: { nestingLevel?: number } }
interface GStructuralElement { paragraph?: GParagraph; table?: { tableRows?: { tableCells?: { content?: GStructuralElement[] }[] }[] } }
interface GTab { tabProperties?: { tabId?: string; title?: string }; documentTab?: { body?: { content?: GStructuralElement[] } }; childTabs?: GTab[] }
export interface GDocument { title?: string; tabs?: GTab[]; body?: { content?: GStructuralElement[] } }

/** A paragraph's runs: the doc's text with its spaces, the paragraph's closing newline dropped, Shift+Enter kept as a line break, same-style neighbours joined. */
function paraRuns(p: GParagraph): DocRun[] {
  const runs: DocRun[] = [];
  const push = (t: string, st: GTextStyle | undefined) => {
    if (!t) return;
    const r: DocRun = { t, ...(st?.bold ? { b: true as const } : {}), ...(st?.italic ? { i: true as const } : {}) };
    const last = runs[runs.length - 1];
    if (last && !!last.b === !!r.b && !!last.i === !!r.i) last.t += t; else runs.push(r);
  };
  if (p.bullet) push("  ".repeat(p.bullet.nestingLevel ?? 0) + "• ", undefined);
  for (const e of p.elements ?? []) {
    if (e.textRun) push((e.textRun.content ?? "").replace(/\u000b/g, "\n"), e.textRun.textStyle);
    else if (e.person) push(e.person.personProperties?.name ?? e.person.personProperties?.email ?? "", e.person.textStyle);
    else if (e.richLink) push(e.richLink.richLinkProperties?.title ?? "", e.richLink.textStyle);
    else if (e.dateElement) push(e.dateElement.dateElementProperties?.displayText ?? "", e.dateElement.textStyle);
  }
  const last = runs[runs.length - 1];
  if (last && last.t.endsWith("\n")) { last.t = last.t.slice(0, -1); if (!last.t) runs.pop(); }
  return runs;
}

const empty = (runs: DocRun[]) => runs.every((r) => r.t === "");

/** A table cell's paragraphs; a table inside the cell becomes one paragraph per row, its cells two spaces apart. */
function cellParas(content: GStructuralElement[] = []): DocPara[] {
  const out: DocPara[] = [];
  for (const el of content) {
    if (el.paragraph) out.push({ runs: paraRuns(el.paragraph) });
    else if (el.table) for (const row of el.table.tableRows ?? []) {
      const runs: DocRun[] = [];
      (row.tableCells ?? []).forEach((c, i) => { if (i) runs.push({ t: "  " }); cellParas(c.content).forEach((p, j) => { if (j) runs.push({ t: " " }); runs.push(...p.runs); }); });
      out.push({ runs });
    }
  }
  while (out.length && empty(out[out.length - 1].runs)) out.pop();
  return out;
}

function blocks(content: GStructuralElement[] = []): DocBlock[] {
  const out: DocBlock[] = [];
  for (const el of content) {
    if (el.paragraph) out.push({ type: "p", runs: paraRuns(el.paragraph) });
    else if (el.table) out.push({ type: "table", rows: (el.table.tableRows ?? []).map((r) => ({ cells: (r.tableCells ?? []).map((c) => ({ paras: cellParas(c.content) })) })) });
  }
  // Docs ends every body with an empty paragraph (and one after a table): drop the blank tail.
  while (out.length && out[out.length - 1].type === "p" && empty((out[out.length - 1] as { runs: DocRun[] }).runs)) out.pop();
  return out;
}

/** The Docs API's document (with includeTabsContent) as DocContent: every tab, child tabs after their parent, in the doc's order. */
export function parseGoogleDoc(d: GDocument): DocContent {
  const tabs: DocTab[] = [];
  const walk = (ts: GTab[] = []) => ts.forEach((t, i) => {
    tabs.push({ id: t.tabProperties?.tabId ?? `t.${tabs.length}`, title: t.tabProperties?.title ?? `Tab ${i + 1}`, blocks: blocks(t.documentTab?.body?.content) });
    walk(t.childTabs);
  });
  walk(d.tabs);
  // Without includeTabsContent the API answers with the first tab's body only.
  if (!tabs.length) tabs.push({ id: "t.0", title: "", blocks: blocks(d.body?.content) });
  return docContentSchema.parse({ tabs });
}

async function readContent(drive: DriveService, id: string): Promise<DocContent> {
  try {
    return parseGoogleDoc(await drive.document(id));
  } catch (e) {
    if (!(e instanceof IntegrationError)) throw e;
    // The Docs API said no (not enabled on the project, or a hiccup): plain text from Drive still reads the doc.
    return docContentFromText(cleanDocText(await drive.export(id, "text/plain")));
  }
}

export async function readDocText(drive: DriveService, file: { driveFileId: string; docText?: string; docContent?: DocContent; docModifiedTime?: string }): Promise<DocTextResult> {
  try {
    const meta = await drive.get(file.driveFileId);
    if (meta.modifiedTime && meta.modifiedTime === file.docModifiedTime && file.docContent)
      return { status: "ok", content: file.docContent, text: file.docText ?? docContentText(file.docContent), modifiedTime: meta.modifiedTime, changed: false };
    const content = await readContent(drive, file.driveFileId);
    const text = docContentText(content);
    const changed = JSON.stringify(content) !== JSON.stringify(file.docContent) || text !== file.docText || meta.modifiedTime !== file.docModifiedTime;
    return { status: "ok", content, text, modifiedTime: meta.modifiedTime, changed };
  } catch (e) {
    if (noAccess(e)) return { status: "noAccess" };
    return { status: "error", message: (e as Error).message };
  }
}
