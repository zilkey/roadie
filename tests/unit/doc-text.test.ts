/** Google Doc parsing (#18) with no database: isGoogleDoc, cleanDocText, parseGoogleDoc, readDocText against stubbed Drive. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { IntegrationError, type DriveService } from "@/server/integrations";
import { cleanDocText, parseGoogleDoc, readDocText, type GDocument } from "@/server/docText";
import { docContentFromText, docContentText } from "@/schema/docContent";
import { isGoogleDoc } from "@/lib/music";

const DOC = "application/vnd.google-apps.document";

test("isGoogleDoc: Google Docs in Drive only, not Word, PDF, Sheets or a link", () => {
  assert.equal(isGoogleDoc({ mimeType: DOC, driveFileId: "x" }), true);
  assert.equal(isGoogleDoc({ mimeType: DOC }), false);
  for (const m of ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf", "application/vnd.google-apps.spreadsheet", "application/vnd.google-apps.presentation", undefined])
    assert.equal(isGoogleDoc({ mimeType: m, driveFileId: "x" }), false, String(m));
});

test("cleanDocText drops the export's byte order mark and CRLFs, keeps runs of spaces", () => {
  assert.equal(cleanDocText("﻿D    A\r\nWords here\r\n\r\n"), "D    A\nWords here");
});

test("parseGoogleDoc: spaces, bold+italic, soft line breaks, bullets, empty paragraphs, child tabs, nested tables", () => {
  const run = (content: string, textStyle: Record<string, boolean> = {}) => ({ textRun: { content, textStyle } });
  const p = (...elements: unknown[]) => ({ paragraph: { elements } });
  const doc = {
    tabs: [{
      tabProperties: { tabId: "t.a", title: "Concert Abm" },
      documentTab: { body: { content: [
        { sectionBreak: {} },
        p(run("    Abm          "), run("Db7", { bold: true }), run("\n")),
        p(run("\n")),
        p(run("line one\u000bline two", { bold: true, italic: true }), run(" tail", { bold: true, italic: true }), run("\n")),
        { paragraph: { elements: [run("first\n")], bullet: { nestingLevel: 1 } } },
        { table: { tableRows: [{ tableCells: [
          { content: [p(run("Pre-Chorus", { bold: true }), run("\n")), p(run("8th note tom build up", { italic: true }), run("\n")), p(run("\n"))] },
          { content: [{ table: { tableRows: [{ tableCells: [{ content: [p(run("a\n"))] }, { content: [p(run("b\n"))] }] }] } }] },
        ] }] } },
        p(run("\n")),
      ] } },
      childTabs: [{ tabProperties: { tabId: "t.b", title: "Drums" }, documentTab: { body: { content: [p(run("Big drums\n", { italic: true }))] } } }],
    }],
  } as GDocument;
  const c = parseGoogleDoc(doc);
  assert.deepEqual(c.tabs.map((t) => t.title), ["Concert Abm", "Drums"]);
  assert.deepEqual(c.tabs[0].blocks, [
    { type: "p", runs: [{ t: "    Abm          " }, { t: "Db7", b: true }] },
    { type: "p", runs: [] },
    { type: "p", runs: [{ t: "line one\nline two tail", b: true, i: true }] },
    { type: "p", runs: [{ t: "  • first" }] },
    { type: "table", rows: [{ cells: [
      { paras: [{ runs: [{ t: "Pre-Chorus", b: true }] }, { runs: [{ t: "8th note tom build up", i: true }] }] },
      { paras: [{ runs: [{ t: "a" }, { t: "  " }, { t: "b" }] }] },
    ] }] },
  ]);
  assert.deepEqual(c.tabs[1].blocks, [{ type: "p", runs: [{ t: "Big drums", i: true }] }]);
  // a doc read without tabs (body only) is one untitled tab
  assert.deepEqual(parseGoogleDoc({ body: { content: [p(run("x\n"))] } } as GDocument).tabs, [{ id: "t.0", title: "", blocks: [{ type: "p", runs: [{ t: "x" }] }] }]);
  assert.equal(docContentText(c), "    Abm          Db7\n\nline one\nline two tail\n  • first\nPre-Chorus / 8th note tom build up  a  b\n\nDrums\n\nBig drums");
});

test("readDocText: 403/404 is noAccess, anything else is an error; the Docs API refusing falls back to the text export; no modifiedTime always re-reads", async () => {
  const refused = async () => { throw new IntegrationError("docs", 403, "Google Docs API has not been used in project 1 before or it is disabled"); };
  const stub = (over: Partial<DriveService>) => ({ get: async () => ({ id: "d", modifiedTime: "t1" }), export: async () => "text", document: refused, ...over }) as unknown as DriveService;
  assert.deepEqual(await readDocText(stub({ export: async () => { throw new IntegrationError("drive", 403, "nope"); } }), { driveFileId: "d" }), { status: "noAccess" });
  // the Docs API off: the doc still reads, as plain text
  const fell = await readDocText(stub({ export: async () => "\uFEFFD   A\r\nWords\r\n" }), { driveFileId: "d" });
  assert.deepEqual(fell, { status: "ok", content: docContentFromText("D   A\nWords"), text: "D   A\nWords", modifiedTime: "t1", changed: true });
  assert.deepEqual(await readDocText(stub({ get: async () => { throw new IntegrationError("drive", 404, "File not found"); } }), { driveFileId: "d" }), { status: "noAccess" });
  const err = await readDocText(stub({ get: async () => { throw new IntegrationError("drive", 500, "boom"); } }), { driveFileId: "d" });
  assert.equal(err.status, "error");
  const cached = docContentFromText("text");
  assert.deepEqual(await readDocText(stub({}), { driveFileId: "d", docText: "text", docContent: cached, docModifiedTime: "t1" }), { status: "ok", content: cached, text: "text", modifiedTime: "t1", changed: false });
  let exported = 0;
  const noTime = stub({ get: async () => ({ id: "d" }) as never, export: async () => { exported++; return "text"; } });
  assert.equal((await readDocText(noTime, { driveFileId: "d", docText: "text" })).status, "ok");
  assert.equal(exported, 1);
});
