import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { GLASS_COAST_LYRICS, WEATHERVANE_DOC } from "../../fakes/fake-drive/server";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { docContentFromText, type DocContent } from "@/schema/docContent";
import { resetEmulators, makeUser } from "./helpers";

// #18: a Google Doc read through the Docs API (tabs, tables, bold and italic) into DocContent, cached on the file with the doc's
// modifiedTime; Drive's text/plain export is the fallback when the Docs API refuses.

let stop: () => Promise<void>;
let dir: string;
let admin: Ctx;
let member: Ctx;
let songId: string;
const DOC = "application/vnd.google-apps.document";

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.DRIVE_BASE_URL = s.running["fake-drive"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};
const fake = (p: string, body: unknown) => fetch(process.env.DRIVE_BASE_URL + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(async () => {
  await resetEmulators();
  await fetch(process.env.DRIVE_BASE_URL + "/__reset", { method: "POST" });
  const a = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  const m = await makeUser("hugo@example.com", "member", { name: "Hugo" });
  admin = { uid: a.uid, role: "admin", via: "app", runId: newRunId() };
  member = { uid: m.uid, role: "member", via: "app", runId: newRunId() };
  songId = (await db.create(admin, "songs", { title: "Glass Coast", status: "active" })).id;
});

const lyricsFile = async (driveFileId = "fake-lyrics-1", extra: Record<string, unknown> = {}) =>
  (await db.create(admin, "files", { kind: "lyrics", title: "Glass Coast lyrics", songId, driveFileId, provider: "drive", url: `http://localhost:3202/files/${driveFileId}`, mimeType: DOC, checkedAt: new Date(), ...extra })).id;

test("files.docText: the first view exports the doc and caches text and modifiedTime on the file; a member can read it", async () => {
  const id = await lyricsFile();
  const r = await cmd("files.docText", { id }, member);
  assert.equal(r.status, "ok");
  assert.equal(r.text, GLASS_COAST_LYRICS.trimEnd());
  assert.match(r.text, /F#m {10}D {12}A\nSalt on the window/);
  assert.equal(r.content.tabs.length, 1);
  assert.deepEqual(r.content.tabs[0].blocks[3], { type: "p", runs: [{ t: "F#m          D            A" }] }, "spaces kept");
  const f = await db.get("files", id);
  assert.equal(f!.docText, GLASS_COAST_LYRICS.trimEnd());
  assert.deepEqual(f!.docContent, r.content);
  assert.equal(f!.docModifiedTime, "2026-09-01T12:00:00.000Z");
});

test("files.docText: an unchanged doc is not exported again and the file is not rewritten; an edited one is", async () => {
  const id = await lyricsFile();
  await cmd("files.docText", { id }, admin);
  const rev = (await db.get("files", id))!.rev;
  // the cache answers when modifiedTime is unchanged: a stale cached copy proves the doc wasn't read again
  await db.update(admin, "files", id, { docText: "cached", docContent: docContentFromText("cached") });
  const rev2 = (await db.get("files", id))!.rev;
  const again = await cmd("files.docText", { id }, admin);
  assert.equal(again.text, "cached");
  assert.deepEqual(again.content, docContentFromText("cached"));
  assert.equal((await db.get("files", id))!.rev, rev2, "no write when nothing changed");
  assert.ok(rev2 > rev);
  // an edit in Docs bumps modifiedTime: the next view exports the new text
  await fake("/files/fake-lyrics-1/__doc", { text: "New words" });
  assert.equal((await cmd("files.docText", { id }, admin)).text, "New words");
  const f = await db.get("files", id);
  assert.equal(f!.docText, "New words");
  assert.deepEqual(f!.docContent!.tabs[0].blocks, [{ type: "p", runs: [{ t: "New words" }] }]);
  assert.notEqual(f!.docModifiedTime, "2026-09-01T12:00:00.000Z");
});

test("files.docText: a doc the band account can't read is noAccess (not an error), and the cache stays", async () => {
  // cached and current: the doc's metadata is read first, so losing access shows even when the text hasn't changed
  const id = await lyricsFile("fake-lyrics-1", { docText: "old", docModifiedTime: "2026-09-01T12:00:00.000Z" });
  await fake("/files/fake-lyrics-1/__doc", { noAccess: true });
  assert.deepEqual(await cmd("files.docText", { id }, member), { status: "noAccess" });
  assert.equal((await db.get("files", id))!.docText, "old");
  // gone from Drive (404) reads the same
  const gone = await lyricsFile("no-such-doc");
  assert.deepEqual(await cmd("files.docText", { id: gone }, member), { status: "noAccess" });
});

test("files.docText: a text-only cache from before (no docContent) is read again even when the doc hasn't changed", async () => {
  const id = await lyricsFile("fake-lyrics-1", { docText: "old", docModifiedTime: "2026-09-01T12:00:00.000Z" });
  const r = await cmd("files.docText", { id }, admin);
  assert.equal(r.text, GLASS_COAST_LYRICS.trimEnd());
  assert.ok((await db.get("files", id))!.docContent);
});

test("files.docText: a doc with tabs and tables comes back as tabs of tables with bold and italic", async () => {
  const id = await lyricsFile("fake-band-weathervane");
  const r = await cmd("files.docText", { id }, admin);
  const c = r.content as DocContent;
  assert.deepEqual(c.tabs.map((t) => [t.id, t.title]), [["t.0", "Concert D"], ["t.1", "Drums"]]);
  assert.deepEqual(c.tabs[0].blocks[0], { type: "p", runs: [{ t: "Weathervane", b: true }, { t: " - By Nora Quill" }] });
  const tbl = c.tabs[1].blocks[2];
  assert.equal(tbl.type, "table");
  if (tbl.type !== "table") return;
  assert.deepEqual(tbl.rows[1].cells[0].paras, [{ runs: [{ t: "Verse 1", b: true }] }, { runs: [{ t: "Add kick drum", i: true }] }]);
  assert.deepEqual(tbl.rows[1].cells[1].paras.map((p) => p.runs[0].t), ["Wind on the barn roof", "Turning me round"]);
  assert.match(r.text, /^Weathervane - By Nora Quill/);
  assert.match(r.text, /\n\nDrums\n\nWeathervane - Drums/, "later tabs under their title in the plain text");
  assert.equal(c.tabs[1].blocks.length, 3, "the closing empty paragraph is dropped");
  void WEATHERVANE_DOC;
});

test("files.docText refuses a file that isn't a Google Doc, and a removed one", async () => {
  const word = (await db.create(admin, "files", { kind: "chart", title: "Glass Coast chart F#m.docx", songId, driveFileId: "fake-chart-1-b", provider: "drive", url: "http://localhost:3202/files/fake-chart-1-b", mimeType: "application/pdf", checkedAt: new Date() })).id;
  await assert.rejects(cmd("files.docText", { id: word }, admin), /Only a Google Doc/);
  const id = await lyricsFile();
  await db.softDelete(admin, "files", id);
  await assert.rejects(cmd("files.docText", { id }, admin), /File not found/);
});
