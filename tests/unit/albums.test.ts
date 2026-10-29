import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { navFor } from "@/lib/nav";
import { DEFAULT_SECTION_ORDER, defaultHidden } from "@/schema/sections";
import { resolveRoute, routeForPath } from "@/lib/routes";
import { guessAlbumKind, guessVersion, latestMix, mixLabel, sidesFor, sidesOf, trackProgress } from "@/lib/albums";
import { needsConfirm, summarize } from "@/server/assistant/policy";
import { groupsFor } from "@/server/assistant/toolset";
import { searchAll } from "@/server/assistant/context";
import { topicForPage, topicInWords } from "@/lib/help";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx, mctx: Ctx;
let songs: string[];
let templateId: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.DRIVE_BASE_URL = s.running["fake-drive"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const code = (p: Promise<unknown>, c: string) => assert.rejects(p, (e: any) => e.code === c); // eslint-disable-line @typescript-eslint/no-explicit-any
const tracksOf = async (albumId: string) => (await db.list(`albums/${albumId}/tracks`)).sort((a, b) => a.position - b.position);

beforeEach(async () => {
  await resetEmulators();
  await fetch(process.env.DRIVE_BASE_URL + "/__reset", { method: "POST" });
  const a = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  const m = await makeUser("david@example.com", "member", { name: "David" });
  mctx = { uid: m.uid, role: "member", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  for (const k of ["jeff", "ingrid"]) await db.create(ctx, "musicians", { name: k, instruments: [], active: true, email: `${k}@example.com` });
  await db.create(ctx, "artists", { slug: "band", name: "Band", driveFolderId: "fake-band-folder", links: {}, configurations: [] }, { id: TEST_ARTIST });
  await cmd("projects.create", { kind: "band", name: "Band", isDefault: true });
  songs = [];
  for (const [title, lengthSec] of [["Glass Coast", 232], ["Weathervane", 250], ["Low Light", 211], ["Ruby Hill", 285]] as [string, number][]) {
    songs.push((await db.create(ctx, "songs", { title, lengthSec, status: "active" })).id);
  }
  templateId = (await cmd("setlistTemplates.create", { name: "Set", items: [{ type: "song", songId: songs[1] }, { type: "break" }, { type: "song", songId: songs[0] }, { type: "song", songId: songs[2] }] })).id;
});

test("pure helpers: sides, progress, versions, kinds, the latest mix", () => {
  assert.deepEqual(sidesFor(4, []), [undefined, undefined, undefined, undefined]);
  assert.deepEqual(sidesFor(5, [2]), ["A", "A", "B", "B", "B"]);
  assert.deepEqual(sidesFor(5, [3, 1]), ["A", "B", "B", "C", "C"]);
  assert.deepEqual(sidesFor(3, [0, 7]), [undefined, undefined, undefined]);
  const groups = sidesOf([{ side: "A", lengthSec: 10 }, { side: "A", lengthSec: 20 }, { side: "B", lengthSec: 5 }]);
  assert.deepEqual(groups.map((g) => [g.side, g.tracks.length, g.lengthSec]), [["A", 2, 30], ["B", 1, 5]]);
  assert.deepEqual(trackProgress([{ status: "tracking" }, { status: "overdubs" }, { status: "mixing" }, { status: "mixed" }, { status: "mastered" }]), { total: 5, tracked: 4, mixed: 2, mastered: 1 });
  assert.equal(guessVersion("Low Light v4.wav"), 4);
  assert.equal(guessVersion("mix_v12_final.wav"), 12);
  assert.equal(guessVersion("Low Light rough.wav"), undefined);
  assert.equal(guessAlbumKind("Low Light master 44k.wav", "audio/wav", true), "master");
  assert.equal(guessAlbumKind("Low Light v2.wav", "audio/wav", true), "mix");
  assert.equal(guessAlbumKind("Stems v4 (12 files).zip", "application/zip", true), "stems");
  assert.equal(guessAlbumKind("Cover final 3000px.png", "image/png"), "artwork");
  assert.equal(guessAlbumKind("Liner notes", "application/vnd.google-apps.document"), "liner");
  assert.equal(guessAlbumKind("One-sheet", "application/vnd.google-apps.document"), "promo");
  assert.equal(guessAlbumKind("Full album master.wav", "audio/wav"), "master");
  const files = [
    { id: "a", kind: "mix", title: "v1", albumTrackId: "t", version: 1, notes: [{}, {}] },
    { id: "b", kind: "mix", title: "v3", albumTrackId: "t", version: 3, approved: true },
    { id: "c", kind: "master", title: "m", albumTrackId: "t", version: 9 },
    { id: "d", kind: "mix", title: "other", albumTrackId: "u", version: 7 },
  ];
  assert.equal(latestMix(files, "t")?.id, "b");
  assert.equal(mixLabel(latestMix(files, "t")), "v3 · approved");
  assert.equal(mixLabel(files[0]), "v1 · 2 notes");
  assert.equal(mixLabel(undefined), "—");
});

test("nav and routes: Albums sits after Songs for admins only and starts in More; the album routes resolve", () => {
  const on = navFor("admin", [...DEFAULT_SECTION_ORDER], { fans: true }).map((n) => n.key);
  assert.equal(on[on.indexOf("songs") + 1], "albums");
  assert.ok(!navFor("member", [...DEFAULT_SECTION_ORDER]).some((n) => n.key === "albums"));
  assert.ok(defaultHidden("admin").includes("albums"));
  assert.equal(resolveRoute("album", { id: "a1" }, "band")?.href, "/artists/band/albums/a1");
  assert.equal(resolveRoute("albumTrack", { id: "a1", trackId: "t1" })?.href, "/albums/a1/tracks/t1");
  assert.equal(resolveRoute("albumMoney", { id: "a1" })?.href, "/albums/a1?tab=money");
  assert.deepEqual(routeForPath("/artists/band/albums/new"), { route: "newAlbum", params: {}, artist: "band" });
  assert.deepEqual(routeForPath("/artists/band/albums/a1/tracks/t1"), { route: "albumTrack", params: { id: "a1", trackId: "t1" }, artist: "band" });
  assert.equal(routeForPath("/albums/a1")?.route, "album");
});

test("albums.create: its project, the tracklist from a setlist (breaks skipped) then songs, deduped; the album folder in Drive", async () => {
  const r = await cmd("albums.create", { title: "Wild Hearts LP", kind: "album", budget: 600000, releaseDate: "2027-03-06", setlistId: templateId, songIds: [songs[0], songs[3]], makeFolder: true });
  const album = (await db.get("albums", r.id))!;
  assert.equal(album.projectId, r.projectId);
  assert.equal(album.budget, 600000);
  const project = (await db.get("projects", r.projectId))!;
  assert.equal(project.kind, "album");
  assert.equal(project.name, "Wild Hearts LP");
  assert.equal(project.status, "open");
  const tracks = await tracksOf(r.id);
  assert.deepEqual(tracks.map((t) => [t.position, t.title, t.status, t.lengthSec]), [[1, "Weathervane", "tracking", 250], [2, "Glass Coast", "tracking", 232], [3, "Low Light", "tracking", 211], [4, "Ruby Hill", "tracking", 285]]);
  assert.equal(r.trackIds.length, 4);
  assert.equal(r.folder.name, "Wild Hearts LP");
  assert.equal((await db.get("albums", r.id))!.driveFolderId, r.folder.id);
  // Band folder / Albums / {title}: the Albums folder is found (or made) in the band folder; a second album goes beside the first
  const second = await cmd("albums.create", { title: "EP two", makeFolder: true });
  assert.notEqual(second.folder.id, r.folder.id);
  // asking again reuses the folder
  assert.equal((await cmd("albums.folder", { id: r.id })).id, r.folder.id);

  // renaming the album renames its project; members can't write
  await cmd("albums.update", { id: r.id, patch: { title: "Wild Hearts", status: "mixing", budget: null } });
  assert.equal((await db.get("projects", r.projectId))!.name, "Wild Hearts");
  assert.equal((await db.get("albums", r.id))!.budget, undefined);
  for (const n of ["albums.create", "albums.update", "albums.remove", "albums.tracks.add", "albums.tracks.update", "albums.files.attach", "albums.files.approve"]) assert.ok(!registry[n].roles.includes("member"), n);
  // no band folder: the album is still made, without a folder
  await db.update(ctx, "artists", TEST_ARTIST, { driveFolderId: "" });
  const bare = await cmd("albums.create", { title: "EP", kind: "ep", makeFolder: true });
  assert.equal(bare.folder, null);
  await code(cmd("albums.folder", { id: bare.id }), "no_band_folder");
});

test("tracks: add (skipping songs already on), reorder keeps the side breaks by position, side breaks, remove renumbers, update", async () => {
  const { id } = await cmd("albums.create", { title: "LP", songIds: [songs[0], songs[1]] });
  const add = await cmd("albums.tracks.add", { albumId: id, songIds: [songs[1], songs[2]], setlistId: templateId });
  // the setlist (Weathervane, Glass Coast, Low Light) comes first, then the songs: only Low Light is new
  assert.equal(add.ids.length, 1);
  let tracks = await tracksOf(id);
  assert.deepEqual(tracks.map((t) => t.title), ["Glass Coast", "Weathervane", "Low Light"]);
  assert.equal(add.skipped, 2);
  await cmd("albums.tracks.add", { albumId: id, songIds: [songs[3]] });
  tracks = await tracksOf(id);
  assert.deepEqual(tracks.map((t) => t.position), [1, 2, 3, 4]);

  // Side B starts at track 3
  const sides = await cmd("albums.tracks.sideBreak", { albumId: id, atTrackId: tracks[2].id });
  assert.deepEqual(sides.sides, ["A", "B"]);
  tracks = await tracksOf(id);
  assert.deepEqual(tracks.map((t) => t.side), ["A", "A", "B", "B"]);
  await code(cmd("albums.tracks.sideBreak", { albumId: id, atTrackId: tracks[0].id }), "invalid_input");
  // reorder: the last track to the top; the break stays at position 3
  await cmd("albums.tracks.reorder", { albumId: id, ids: [tracks[3].id, tracks[0].id, tracks[1].id, tracks[2].id] });
  tracks = await tracksOf(id);
  assert.deepEqual(tracks.map((t) => [t.position, t.title, t.side]), [[1, "Ruby Hill", "A"], [2, "Glass Coast", "A"], [3, "Weathervane", "B"], [4, "Low Light", "B"]]);
  await code(cmd("albums.tracks.reorder", { albumId: id, ids: [tracks[0].id] }), "invalid_input");
  await code(cmd("albums.tracks.reorder", { albumId: id, ids: [tracks[0].id, tracks[0].id, tracks[1].id, tracks[2].id] }), "invalid_input");
  // remove the break
  await cmd("albums.tracks.sideBreak", { albumId: id, atTrackId: tracks[2].id, remove: true });
  assert.deepEqual((await tracksOf(id)).map((t) => t.side), [undefined, undefined, undefined, undefined]);
  await cmd("albums.tracks.sideBreak", { albumId: id, atTrackId: tracks[1].id });
  await cmd("albums.tracks.sideBreak", { albumId: id, atTrackId: null });
  assert.deepEqual((await tracksOf(id)).map((t) => t.side), [undefined, undefined, undefined, undefined]);

  // remove the second track: the rest close up
  await cmd("albums.tracks.remove", { albumId: id, id: tracks[1].id });
  tracks = await tracksOf(id);
  assert.deepEqual(tracks.map((t) => [t.position, t.title]), [[1, "Ruby Hill"], [2, "Weathervane"], [3, "Low Light"]]);
  // update: title on the album only, credits, isrc
  await cmd("albums.tracks.update", { albumId: id, id: tracks[0].id, patch: { title: "Ruby Hill (album version)", status: "overdubs", isrc: "USX9P2600001", credits: [{ who: "Ingrid", role: "Vocals" }] } });
  const t = (await db.get(`albums/${id}/tracks`, tracks[0].id))!;
  assert.equal(t.title, "Ruby Hill (album version)");
  assert.equal(t.status, "overdubs");
  assert.deepEqual(t.credits, [{ who: "Ingrid", role: "Vocals" }]);
  assert.equal((await db.get("songs", songs[3]))!.title, "Ruby Hill");
  await code(cmd("albums.tracks.update", { albumId: id, id: "nope", patch: { title: "x" } }), "not_found");
});

test("files: mixes by version on a track, approving one makes it mixed, a master mastered; notes; album-level artwork; removing the album", async () => {
  const { id } = await cmd("albums.create", { title: "LP", songIds: [songs[2]] });
  const [track] = await tracksOf(id);
  const a = await cmd("albums.files.attach", { albumId: id, trackId: track.id, files: [{ driveFileId: "fake-album-mix-1" }, { driveFileId: "fake-album-mix-2" }] });
  assert.equal(a.ids.length, 2);
  const mixes = (await db.list("files")).filter((f) => f.albumTrackId === track.id).sort((x, y) => x.version - y.version);
  assert.deepEqual(mixes.map((f) => [f.kind, f.version, f.albumId, f.songId]), [["mix", 1, id, undefined], ["mix", 2, id, undefined]]);
  assert.equal(mixes[0].inBandFolder, true); // the Drive folder is the album's
  // the same file again is skipped; a mix with no version in its name is the next one
  const again = await cmd("albums.files.attach", { albumId: id, trackId: track.id, files: [{ driveFileId: "fake-album-mix-1" }, { url: "https://example.com/mix-rough", kind: "mix", title: "Rough" }] });
  assert.equal(again.skipped, 1);
  assert.equal((await db.get("files", again.ids[0]))!.version, 3);
  assert.equal((await db.get(`albums/${id}/tracks`, track.id))!.status, "tracking");
  await cmd("albums.files.approve", { id: mixes[1].id, approved: true });
  assert.equal((await db.get("files", mixes[1].id))!.approved, true);
  assert.equal((await db.get(`albums/${id}/tracks`, track.id))!.status, "mixed");
  await cmd("albums.files.approve", { id: mixes[1].id, approved: false });
  assert.equal((await db.get("files", mixes[1].id))!.approved, undefined);
  assert.equal((await db.get(`albums/${id}/tracks`, track.id))!.status, "mixed"); // stays
  // a master, approved on attach
  const m = await cmd("albums.files.attach", { albumId: id, trackId: track.id, files: [{ url: "https://example.com/master", kind: "master" }], approved: true });
  assert.equal((await db.get("files", m.ids[0]))!.version, 1);
  assert.equal((await db.get(`albums/${id}/tracks`, track.id))!.status, "mastered");
  // notes carry who said it
  const n = await cmd("albums.files.note", { id: mixes[0].id, body: "Guitar solo a touch quieter." });
  const noted = (await db.get("files", mixes[0].id))!.notes as { id: string; name: string; body: string; authorId: string }[];
  assert.equal(noted.length, 1);
  assert.equal(noted[0].id, n.id);
  assert.equal(noted[0].name, "Jeff");
  assert.equal(noted[0].authorId, ctx.uid);
  // album-level artwork, kind guessed from the name, no track
  const art = await cmd("albums.files.attach", { albumId: id, files: [{ driveFileId: "fake-album-cover" }] });
  const cover = (await db.get("files", art.ids[0]))!;
  assert.equal(cover.kind, "artwork");
  assert.equal(cover.albumTrackId, undefined);
  await code(cmd("albums.files.note", { id: "nope", body: "x" }), "not_found");
  await code(cmd("albums.files.attach", { albumId: id, trackId: "nope", files: [{ url: "https://x.test/a" }] }), "not_found");

  // money on the track: the expense must be on the album's project
  const album = (await db.get("albums", id))!;
  const e = await cmd("expenses.add", { amount: 30000, what: "Mix v2 revisions", category: "mixing", projectId: album.projectId, albumTrackId: track.id, payBack: false });
  assert.equal((await db.get("expenses", e.id))!.albumTrackId, track.id);
  await code(cmd("expenses.add", { amount: 100, what: "x", category: "mixing", albumTrackId: track.id }), "invalid_input");
  await code(cmd("expenses.add", { amount: 100, what: "x", category: "mixing", projectId: album.projectId, albumTrackId: "nope" }), "not_found");
  const inc = await cmd("income.add", { amount: 50000, category: "preorders", from: "Bandcamp", projectId: album.projectId });
  assert.equal((await db.get("income", inc.id))!.category, "preorders");

  // the song's own files are untouched by the album; removing the album archives its tracks and files and closes the project
  await db.create(ctx, "files", { kind: "demo", title: "Low Light demo", songId: songs[2], url: "https://x.test/demo", provider: "web", checkedAt: new Date() });
  await cmd("albums.remove", { id });
  assert.ok((await db.get("albums", id))!.deletedAt);
  assert.equal((await db.list(`albums/${id}/tracks`)).length, 0);
  assert.deepEqual((await db.list("files")).map((f) => f.title), ["Low Light demo"]);
  assert.equal((await db.get("projects", album.projectId))!.status, "closed");
  await code(cmd("albums.tracks.add", { albumId: id, songIds: [songs[0]] }), "not_found");
});

test("members read albums but can't change them; the member role gets no album commands", async () => {
  const { id } = await cmd("albums.create", { title: "LP", songIds: [songs[0]] });
  assert.ok(await db.get("albums", id));
  for (const n of Object.keys(registry).filter((n) => n.startsWith("albums."))) assert.ok(!registry[n].roles.includes("member"), n);
  void mctx;
});

test("Roadie: albums are a tool group, search finds them, the cards read plainly, help explains the pages", async () => {
  assert.ok(groupsFor("add Big River to the album", [], undefined).includes("albums"));
  assert.ok(groupsFor("we spent $400 on mastering", [], undefined).includes("albums"));
  assert.ok(groupsFor("what's for dinner", [], { route: "album", params: { id: "x" } } as never).includes("albums"));
  assert.ok(!groupsFor("book the Hi-Dive", [], undefined).includes("albums"));
  const { id } = await cmd("albums.create", { title: "Wild Hearts LP", songIds: [songs[0]] });
  const hits = await searchAll(ctx, { q: "wild hearts" });
  assert.deepEqual(hits.results.map((r) => [r.kind, r.id]), [["album", id]]);
  assert.equal((await cmd("records.get", { kind: "albums", id })).title, "Wild Hearts LP");
  assert.equal(summarize("albums.create", { title: "Wild Hearts LP", kind: "album", budget: 600000, setlistId: "s" }), "Start the album Wild Hearts LP (budget $6,000.00), with its own money project and a tracklist");
  assert.equal(summarize("albums.tracks.add", { albumId: id, songIds: ["a", "b"] }, undefined, { title: "Wild Hearts LP" }), "Put 2 songs on the album Wild Hearts LP");
  assert.equal(summarize("albums.files.approve", { id: "f", approved: true }, undefined, { title: "Mix v4" }), "Sign off Mix v4: the track moves on");
  assert.ok(needsConfirm("albums.remove", { id }));
  assert.ok(needsConfirm("albums.files.copyToFolder", { albumId: id, ids: ["a"] }));
  assert.ok(!needsConfirm("albums.tracks.add", { albumId: id, songIds: ["a", "b", "c", "d", "e", "f", "g"] }));
  assert.ok(!needsConfirm("albums.create", { title: "x", songIds: ["a", "b", "c", "d", "e", "f", "g"] }));
  assert.equal(topicForPage("albums")?.id, "albums");
  assert.equal(topicForPage("album")?.id, "albumPage");
  assert.equal(topicForPage("album", "money")?.id, "albumMoney");
  assert.equal(topicForPage("album", "files")?.id, "albumFiles");
  assert.equal(topicForPage("albumTrack")?.id, "albumTrack");
  assert.equal(topicInWords("how do I approve a mix?")?.id, "albumTrack");
  assert.equal(topicInWords("what's on the album page")?.id, "albumPage");
});
