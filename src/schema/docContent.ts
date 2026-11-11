import { z } from "zod";

/**
 * A Google Doc as the song and rehearsal pages show it: its tabs, and in each tab paragraphs and tables, the text in runs that
 * carry bold and italic. Read from the Docs API (documents.get with tabs) by src/server/docContent.ts and cached on the file.
 * Objects wrap every list so it stores in Firestore (no arrays directly inside arrays).
 */
export const docRun = z.strictObject({ t: z.string(), b: z.literal(true).optional(), i: z.literal(true).optional() });
/** One paragraph: its text with the doc's own spaces; a soft line break (Shift+Enter) is "\n" inside a run. */
export const docPara = z.strictObject({ runs: z.array(docRun) });
export const docCell = z.strictObject({ paras: z.array(docPara) });
export const docRow = z.strictObject({ cells: z.array(docCell) });
export const docBlock = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("p"), runs: z.array(docRun) }),
  z.strictObject({ type: z.literal("table"), rows: z.array(docRow) }),
]);
export const docTab = z.strictObject({ id: z.string(), title: z.string(), blocks: z.array(docBlock) });
export const docContent = z.strictObject({ tabs: z.array(docTab) });

export type DocRun = z.infer<typeof docRun>;
export type DocPara = z.infer<typeof docPara>;
export type DocBlock = z.infer<typeof docBlock>;
export type DocTab = z.infer<typeof docTab>;
export type DocContent = z.infer<typeof docContent>;

const runsText = (runs: DocRun[]) => runs.map((r) => r.t).join("");

/** The tab as plain text: paragraphs on their own lines, a table row's cells side by side with two spaces between. */
export function tabText(tab: DocTab): string {
  return tab.blocks.map((b) => b.type === "p" ? runsText(b.runs)
    : b.rows.map((r) => r.cells.map((c) => c.paras.map((p) => runsText(p.runs)).join(" / ")).join("  ")).join("\n")).join("\n");
}

/** The whole doc as plain text (each tab after the first under its title), for docText and anything reading text. */
export function docContentText(c: DocContent): string {
  return c.tabs.map((t, i) => (i === 0 || c.tabs.length === 1 ? "" : `${t.title}\n\n`) + tabText(t)).join("\n\n").replace(/\s+$/, "");
}

/** Plain text (Drive's text/plain export, or a docText cached before #18's follow-up) as one untitled tab of paragraphs. */
export function docContentFromText(text: string): DocContent {
  return { tabs: [{ id: "t.0", title: "", blocks: text === "" ? [] : text.split("\n").map((t) => ({ type: "p" as const, runs: t ? [{ t }] : [] })) }] };
}
