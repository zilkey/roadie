// setlists.pdf: a setlist's charts, exported from Google Docs by the (fake) Drive, as one PDF in Charts / Setlists.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { driveClient } from "@/server/integrations";
import { buildSetlistPdf, chartFor } from "@/server/setlistPdf";
import { isExcluded } from "@/server/assistant/policy";
import { resetEmulators, makeUser, venue, TEST_ARTIST, SYS } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx, mctx: Ctx;
let DRIVE: string;
const GDOC = "application/vnd.google-apps.document";

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  DRIVE = process.env.DRIVE_BASE_URL = s.running["fake-drive"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const code = (p: Promise<unknown>, c: string) => assert.rejects(p, (e: any) => e.code === c); // eslint-disable-line @typescript-eslint/no-explicit-any
const post = (p: string, body: unknown) => fetch(DRIVE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const song = async (title: string) => (await cmd("songs.create", { title, status: "active", lengthSec: 200 })).id as string;
const chart = (songId: string, driveFileId: string, title: string, extra: Record<string, unknown> = {}) =>
  db.create(ctx, "files", { kind: "chart", title, songId, driveFileId, url: `${DRIVE}/files/${driveFileId}`, mimeType: GDOC, checkedAt: new Date(), ...extra });

let ids: Record<"weather" | "long" | "pdf" | "none" | "alt", string>;
let items: unknown[];

beforeEach(async () => {
  await resetEmulators();
  await fetch(DRIVE + "/__reset", { method: "POST" });
  const a = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  const m = await makeUser("hugo@example.com", "member", { name: "Hugo" });
  mctx = { uid: m.uid, role: "member", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  for (const k of ["rudy", "nora"]) await db.create(ctx, "musicians", { name: k, instruments: [], active: true, email: `${k}@example.com` });
  await db.create(ctx, "artists", { timeZone: "America/Denver", slug: "band", name: "Band", driveFolderId: "fake-band-folder", links: {}, configurations: [] }, { id: TEST_ARTIST });
  await cmd("projects.create", { kind: "band", name: "Band", isDefault: true });

  ids = { weather: await song("Weathervane"), long: await song("Long One"), pdf: await song("Only a PDF"), none: await song("No Chart"), alt: await song("The Alternate") };
  await chart(ids.weather, "fake-band-weathervane", "Weathervane - D - Band Version"); // two tabs
  await chart(ids.weather, "fake-lyrics-2", "Weathervane - Lyrics - Band Version");     // not the one picked
  await post("/files/fake-lyrics-3/__doc", { text: "A long chart (two pages)" });
  await chart(ids.long, "fake-lyrics-3", "Long One chart");                             // two pages: only the first is kept
  await chart(ids.pdf, "fake-chart-4-b", "Only a PDF.pdf", { mimeType: "application/pdf" });
  await chart(ids.none, "fake-chart-5-a", "No Chart.docx", { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  await chart(ids.alt, "fake-lyrics-6", "The Alternate chart");
  items = [
    { type: "song", songId: ids.weather },
    { type: "break", title: "Break", lengthSec: 600 },
    { type: "song", songId: ids.long, alts: [{ songId: ids.alt }] },
    { type: "song", songId: ids.pdf },
    { type: "song", songId: ids.none },
    { type: "song", title: "A cover we don't have" },
  ];
});

const showWithSetlist = async () => {
  const venueId = (await cmd("venues.create", venue("Deep End", "Denver"))).id;
  const { id } = await cmd("shows.create", { date: "2027-01-16", venueId, times: {}, needs: { poster: false, backline: false, merch: false } });
  await cmd("setlists.setItems", { showId: id, items });
  return id as string;
};

test("chartFor: a Google Doc before a PDF, the chart in the setlist's key first, the band chart before a lyrics one", () => {
  const f = (id: string, o: Record<string, unknown>) => ({ id, songId: "s", driveFileId: id, kind: "chart", mimeType: GDOC, title: id, ...o }) as never;
  assert.equal(chartFor([f("Song.pdf", { mimeType: "application/pdf" }), f("Song - Lyrics - Band Version", {}), f("Song - Band Version", {})], "s")!.id, "Song - Band Version");
  assert.equal(chartFor([f("Song in D", { key: "D" }), f("Song in F long title", { key: "F" })], "s", "f")!.id, "Song in F long title");
  assert.equal(chartFor([f("lyrics", { kind: "lyrics" }), f("a.pdf", { mimeType: "application/pdf" })], "s")!.id, "lyrics");
  assert.equal(chartFor([f("word", { mimeType: "application/msword" }), f("demo", { kind: "demo" }), f("other song", { songId: "t" })], "s"), null);
});

test("setlists.pdf needs the Charts folder; then it saves \"{date} {venue}.pdf\" in Charts / Setlists, shared with the band, one page per song, tab and alternate", async () => {
  const showId = await showWithSetlist();
  await code(cmd("setlists.pdf", { showId }), "no_charts_folder");
  await cmd("google.setChartsFolder", { folder: "fake-folder-charts" });

  const r = await cmd("setlists.pdf", { showId }, mctx); // a member can
  assert.equal(r.name, "2027-01-16 Deep End.pdf");
  assert.equal(r.folder.name, "Setlists");
  assert.deepEqual(r.pages, [
    { title: "Weathervane", tab: "Concert D" }, { title: "Weathervane", tab: "Drums" },
    { title: "Long One" }, { title: "The Alternate", alt: true }, { title: "Only a PDF" },
  ]);
  assert.deepEqual(r.skipped.map((s: { title: string }) => s.title), ["No Chart", "A cover we don't have"]);

  const drive = driveClient({ artistId: TEST_ARTIST });
  const folder = (await drive.search({ parent: "fake-folder-charts", mimeType: "application/vnd.google-apps.folder" })).find((f) => f.name === "Setlists")!;
  assert.ok(folder.permissions.some((p) => p.email === "nora@example.com"));
  const inside = await drive.search({ parent: folder.id });
  assert.deepEqual(inside.map((f) => [f.name, f.mimeType]), [["2027-01-16 Deep End.pdf", "application/pdf"]]);
  assert.equal(r.url, inside[0].webViewLink);

  // Again: the same file, saved over; no second folder or file.
  const again = await cmd("setlists.pdf", { showId });
  assert.equal(again.url, r.url);
  assert.equal((await drive.search({ parent: folder.id })).length, 1);
  assert.equal((await drive.search({ parent: "fake-folder-charts", mimeType: "application/vnd.google-apps.folder" })).filter((f) => f.name === "Setlists").length, 1);
});

test("the PDF itself: one page each, the first page only of a two-page chart; when Google won't export a tab alone, the doc's first page", async () => {
  await cmd("google.setChartsFolder", { folder: "fake-folder-charts" });
  const t = await cmd("setlistTemplates.create", { name: "Club set", items: items.filter((i) => (i as { songId?: string }).songId || (i as { type: string }).type === "break") });
  const tpl = (await db.get(SYS, "setlistTemplates", t.id))!;
  const drive = driveClient({ artistId: TEST_ARTIST });
  const pdf = await buildSetlistPdf(drive, tpl.items as never, await db.list(SYS, "files"), "Club set");
  assert.equal(pdf.pages.length, 5);
  assert.equal((await PDFDocument.load(pdf.bytes)).getPageCount(), 5); // the long chart and the PDF chart each have a second page that is dropped

  const r = await cmd("setlists.pdf", { setlistId: t.id });
  assert.equal(r.name, "Club set.pdf");

  await post("/__scenario", { noTabExport: true });
  const flat = await buildSetlistPdf(drive, tpl.items as never, await db.list(SYS, "files"), "Club set");
  assert.deepEqual(flat.pages.slice(0, 2), [{ title: "Weathervane" }, { title: "Long One" }]);
  assert.equal((await PDFDocument.load(flat.bytes)).getPageCount(), 4);

  // A doc the band account can't open is left out, with why.
  await post("/files/fake-lyrics-3/__doc", { noAccess: true });
  const less = await cmd("setlists.pdf", { setlistId: t.id });
  assert.deepEqual(less.skipped.find((s: { title: string }) => s.title === "Long One"), { title: "Long One", reason: "The band's Google account can't open its chart" });
});

test("setlists.pdf: exactly one of setlistId and showId, a setlist with no chart at all is refused, and it isn't a Roadie or MCP tool", async () => {
  await cmd("google.setChartsFolder", { folder: "fake-folder-charts" });
  assert.throws(() => registry["setlists.pdf"].input.parse({}));
  assert.throws(() => registry["setlists.pdf"].input.parse({ setlistId: "a", showId: "b" }));
  await code(cmd("setlists.pdf", { setlistId: "nope" }), "not_found");
  const t = await cmd("setlistTemplates.create", { name: "Bare", items: [{ type: "song", songId: ids.none }] });
  await code(cmd("setlists.pdf", { setlistId: t.id }), "no_charts");
  assert.ok(!registry["setlists.pdf"].roles.includes("mcp"));
  assert.ok(isExcluded("setlists.pdf"));
});
