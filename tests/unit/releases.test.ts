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
import { guessReleaseKind, guessVersion, latestMix, mixLabel, sidesFor, sidesOf, spentByTrack, trackProgress } from "@/lib/releases";
import { needsConfirm, summarize } from "@/server/assistant/policy";
import { groupsFor } from "@/server/assistant/toolset";
import { searchAll } from "@/server/assistant/context";
import { topicForPage, topicInWords } from "@/lib/help";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";
import { firestore } from "@/server/admin";
import { migrateReleases } from "../../scripts/migrate-releases";

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
const tracksOf = async (releaseId: string) => (await db.list(`releases/${releaseId}/tracks`)).sort((a, b) => a.position - b.position);

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

test("spentByTrack: each track in order (nothing spent reads 0), then Whole release; removed lines skipped, a gone track's lines count as whole release", () => {
  const tracks = [{ id: "t2", position: 2, title: "Low Light" }, { id: "t1", position: 1, title: "Opener" }];
  const rows = spentByTrack(tracks, [
    { amount: 30000, releaseTrackId: "t2" }, { amount: 5000, releaseTrackId: "t2" }, { amount: 180000 },
    { amount: 999, releaseTrackId: "t1", deletedAt: "x" }, { amount: 700, releaseTrackId: "gone" },
  ]);
  assert.deepEqual(rows.map((r) => [r.key, r.label, r.out]), [["t1", "1 · Opener", 0], ["t2", "2 · Low Light", 35000], ["release", "Whole release", 180700]]);
  assert.deepEqual(spentByTrack(tracks, [{ amount: 100, releaseTrackId: "t1" }]).map((r) => r.key), ["t1", "t2"]);
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
  assert.equal(guessReleaseKind("Low Light master 44k.wav", "audio/wav", true), "master");
  assert.equal(guessReleaseKind("Low Light v2.wav", "audio/wav", true), "mix");
  assert.equal(guessReleaseKind("Stems v4 (12 files).zip", "application/zip", true), "stems");
  assert.equal(guessReleaseKind("Cover final 3000px.png", "image/png"), "artwork");
  assert.equal(guessReleaseKind("Liner notes", "application/vnd.google-apps.document"), "liner");
  assert.equal(guessReleaseKind("One-sheet", "application/vnd.google-apps.document"), "promo");
  assert.equal(guessReleaseKind("Full release master.wav", "audio/wav"), "master");
  const files = [
    { id: "a", kind: "mix", title: "v1", releaseTrackId: "t", version: 1, notes: [{}, {}] },
    { id: "b", kind: "mix", title: "v3", releaseTrackId: "t", version: 3, approved: true },
    { id: "c", kind: "master", title: "m", releaseTrackId: "t", version: 9 },
    { id: "d", kind: "mix", title: "other", releaseTrackId: "u", version: 7 },
  ];
  assert.equal(latestMix(files, "t")?.id, "b");
  assert.equal(mixLabel(latestMix(files, "t")), "v3 · approved");
  assert.equal(mixLabel(files[0]), "v1 · 2 notes");
  assert.equal(mixLabel(undefined), "—");
});

test("nav and routes: Releases sits after Songs for admins only and starts in More; the release routes resolve", () => {
  const on = navFor("admin", [...DEFAULT_SECTION_ORDER], { fans: true }).map((n) => n.key);
  assert.equal(on[on.indexOf("songs") + 1], "releases");
  assert.ok(!navFor("member", [...DEFAULT_SECTION_ORDER]).some((n) => n.key === "releases"));
  assert.ok(defaultHidden("admin").includes("releases"));
  assert.equal(resolveRoute("release", { id: "a1" }, "band")?.href, "/artists/band/releases/a1");
  assert.equal(resolveRoute("releaseTrack", { id: "a1", trackId: "t1" })?.href, "/releases/a1/tracks/t1");
  assert.equal(resolveRoute("releaseMoney", { id: "a1" })?.href, "/releases/a1?tab=money");
  assert.deepEqual(routeForPath("/artists/band/releases/new"), { route: "newRelease", params: {}, artist: "band" });
  assert.deepEqual(routeForPath("/artists/band/releases/a1/tracks/t1"), { route: "releaseTrack", params: { id: "a1", trackId: "t1" }, artist: "band" });
  assert.equal(routeForPath("/releases/a1")?.route, "release");
});

test("releases.create: its project, the tracklist from a setlist (breaks skipped) then songs, deduped; the release folder in Drive", async () => {
  const r = await cmd("releases.create", { title: "Wild Hearts LP", kind: "album", releaseDate: "2027-03-06", setlistId: templateId, songIds: [songs[0], songs[3]], makeFolder: true });
  const release = (await db.get("releases", r.id))!;
  assert.equal(release.projectId, r.projectId);
  assert.equal(release.status, undefined, "a release has no status of its own");
  assert.equal(release.budget, undefined, "nor a budget");
  const project = (await db.get("projects", r.projectId))!;
  assert.equal(project.kind, "release");
  assert.equal(project.name, "Wild Hearts LP");
  assert.equal(project.status, "open");
  const tracks = await tracksOf(r.id);
  assert.deepEqual(tracks.map((t) => [t.position, t.title, t.status, t.lengthSec]), [[1, "Weathervane", "tracking", 250], [2, "Glass Coast", "tracking", 232], [3, "Low Light", "tracking", 211], [4, "Ruby Hill", "tracking", 285]]);
  assert.equal(r.trackIds.length, 4);
  assert.equal(r.folder.name, "Wild Hearts LP");
  assert.equal((await db.get("releases", r.id))!.driveFolderId, r.folder.id);
  assert.equal((await db.get("releases", r.id))!.driveFolderName, "Wild Hearts LP");
  // Band folder / Releases / {title}: the Releases folder is found (or made) in the band folder; a second release goes beside the first
  const second = await cmd("releases.create", { title: "EP two", makeFolder: true });
  assert.notEqual(second.folder.id, r.folder.id);
  // asking again reuses the folder
  assert.equal((await cmd("releases.folder", { id: r.id })).id, r.folder.id);

  // renaming the release renames its project; members can't write
  await cmd("releases.update", { id: r.id, patch: { title: "Wild Hearts" } });
  assert.equal((await db.get("projects", r.projectId))!.name, "Wild Hearts");
  await assert.rejects(cmd("releases.update", { id: r.id, patch: { status: "mixing" } }), "status is not a release field any more");
  await assert.rejects(cmd("releases.update", { id: r.id, patch: { budget: 100 } }), "nor is budget");
  for (const n of ["releases.create", "releases.update", "releases.remove", "releases.tracks.add", "releases.tracks.update", "releases.files.attach", "releases.files.approve"]) assert.ok(!registry[n].roles.includes("member"), n);
  // no band folder: the release is still made, without a folder
  await db.update(ctx, "artists", TEST_ARTIST, { driveFolderId: "" });
  const bare = await cmd("releases.create", { title: "EP", kind: "ep", makeFolder: true });
  assert.equal(bare.folder, null);
  await code(cmd("releases.folder", { id: bare.id }), "no_band_folder");
  // a folder picked at creation can be anywhere in Drive (no band folder needed): by id or link; a file or an unknown folder is refused
  const picked = await cmd("releases.create", { title: "Picked", driveFolderId: "https://drive.google.com/drive/folders/fake-folder-rehearsals?usp=sharing" });
  assert.deepEqual([picked.folder.id, picked.folder.name], ["fake-folder-rehearsals", "Rehearsal recordings"]);
  assert.equal((await db.get("releases", picked.id))!.driveFolderName, "Rehearsal recordings");
  assert.equal((await cmd("releases.folder", { id: picked.id })).id, "fake-folder-rehearsals");
  await code(cmd("releases.create", { title: "Bad", driveFolderId: "fake-release-mix-1" }), "invalid_input");
  await code(cmd("releases.create", { title: "Bad", driveFolderId: "nope-not-a-folder" }), "not_found");
});

test("tracks: add (skipping songs already on), reorder keeps the side breaks by position, side breaks, remove renumbers, update", async () => {
  const { id } = await cmd("releases.create", { title: "LP", songIds: [songs[0], songs[1]] });
  const add = await cmd("releases.tracks.add", { releaseId: id, songIds: [songs[1], songs[2]], setlistId: templateId });
  // the setlist (Weathervane, Glass Coast, Low Light) comes first, then the songs: only Low Light is new
  assert.equal(add.ids.length, 1);
  let tracks = await tracksOf(id);
  assert.deepEqual(tracks.map((t) => t.title), ["Glass Coast", "Weathervane", "Low Light"]);
  assert.equal(add.skipped, 2);
  await cmd("releases.tracks.add", { releaseId: id, songIds: [songs[3]] });
  tracks = await tracksOf(id);
  assert.deepEqual(tracks.map((t) => t.position), [1, 2, 3, 4]);

  // Side B starts at track 3
  const sides = await cmd("releases.tracks.sideBreak", { releaseId: id, atTrackId: tracks[2].id });
  assert.deepEqual(sides.sides, ["A", "B"]);
  tracks = await tracksOf(id);
  assert.deepEqual(tracks.map((t) => t.side), ["A", "A", "B", "B"]);
  await code(cmd("releases.tracks.sideBreak", { releaseId: id, atTrackId: tracks[0].id }), "invalid_input");
  // reorder: the last track to the top; the break stays at position 3
  await cmd("releases.tracks.reorder", { releaseId: id, ids: [tracks[3].id, tracks[0].id, tracks[1].id, tracks[2].id] });
  tracks = await tracksOf(id);
  assert.deepEqual(tracks.map((t) => [t.position, t.title, t.side]), [[1, "Ruby Hill", "A"], [2, "Glass Coast", "A"], [3, "Weathervane", "B"], [4, "Low Light", "B"]]);
  await code(cmd("releases.tracks.reorder", { releaseId: id, ids: [tracks[0].id] }), "invalid_input");
  await code(cmd("releases.tracks.reorder", { releaseId: id, ids: [tracks[0].id, tracks[0].id, tracks[1].id, tracks[2].id] }), "invalid_input");
  // remove the break
  await cmd("releases.tracks.sideBreak", { releaseId: id, atTrackId: tracks[2].id, remove: true });
  assert.deepEqual((await tracksOf(id)).map((t) => t.side), [undefined, undefined, undefined, undefined]);
  await cmd("releases.tracks.sideBreak", { releaseId: id, atTrackId: tracks[1].id });
  await cmd("releases.tracks.sideBreak", { releaseId: id, atTrackId: null });
  assert.deepEqual((await tracksOf(id)).map((t) => t.side), [undefined, undefined, undefined, undefined]);

  // remove the second track: the rest close up
  await cmd("releases.tracks.remove", { releaseId: id, id: tracks[1].id });
  tracks = await tracksOf(id);
  assert.deepEqual(tracks.map((t) => [t.position, t.title]), [[1, "Ruby Hill"], [2, "Weathervane"], [3, "Low Light"]]);
  // update: title on the release only, credits, isrc
  await cmd("releases.tracks.update", { releaseId: id, id: tracks[0].id, patch: { title: "Ruby Hill (release version)", status: "overdubs", isrc: "USX9P2600001", credits: [{ who: "Ingrid", role: "Vocals" }] } });
  const t = (await db.get(`releases/${id}/tracks`, tracks[0].id))!;
  assert.equal(t.title, "Ruby Hill (release version)");
  assert.equal(t.status, "overdubs");
  assert.deepEqual(t.credits, [{ who: "Ingrid", role: "Vocals" }]);
  assert.equal((await db.get("songs", songs[3]))!.title, "Ruby Hill");
  await code(cmd("releases.tracks.update", { releaseId: id, id: "nope", patch: { title: "x" } }), "not_found");
});

test("files: mixes by version on a track, approving one makes it mixed, a master mastered; notes; release-level artwork; removing the release", async () => {
  const { id } = await cmd("releases.create", { title: "LP", songIds: [songs[2]] });
  const [track] = await tracksOf(id);
  const a = await cmd("releases.files.attach", { releaseId: id, trackId: track.id, files: [{ driveFileId: "fake-release-mix-1" }, { driveFileId: "fake-release-mix-2" }] });
  assert.equal(a.ids.length, 2);
  const mixes = (await db.list("files")).filter((f) => f.releaseTrackId === track.id).sort((x, y) => x.version - y.version);
  assert.deepEqual(mixes.map((f) => [f.kind, f.version, f.releaseId, f.songId]), [["mix", 1, id, undefined], ["mix", 2, id, undefined]]);
  assert.equal(mixes[0].inBandFolder, true); // the Drive folder is the release's
  // the same file again is skipped; a mix with no version in its name is the next one
  const again = await cmd("releases.files.attach", { releaseId: id, trackId: track.id, files: [{ driveFileId: "fake-release-mix-1" }, { url: "https://example.com/mix-rough", kind: "mix", title: "Rough" }] });
  assert.equal(again.skipped, 1);
  assert.equal((await db.get("files", again.ids[0]))!.version, 3);
  assert.equal((await db.get(`releases/${id}/tracks`, track.id))!.status, "tracking");
  await cmd("releases.files.approve", { id: mixes[1].id, approved: true });
  assert.equal((await db.get("files", mixes[1].id))!.approved, true);
  assert.equal((await db.get(`releases/${id}/tracks`, track.id))!.status, "mixed");
  await cmd("releases.files.approve", { id: mixes[1].id, approved: false });
  assert.equal((await db.get("files", mixes[1].id))!.approved, undefined);
  assert.equal((await db.get(`releases/${id}/tracks`, track.id))!.status, "mixed"); // stays
  // a master, approved on attach
  const m = await cmd("releases.files.attach", { releaseId: id, trackId: track.id, files: [{ url: "https://example.com/master", kind: "master" }], approved: true });
  assert.equal((await db.get("files", m.ids[0]))!.version, 1);
  assert.equal((await db.get(`releases/${id}/tracks`, track.id))!.status, "mastered");
  // notes carry who said it
  const n = await cmd("releases.files.note", { id: mixes[0].id, body: "Guitar solo a touch quieter." });
  const noted = (await db.get("files", mixes[0].id))!.notes as { id: string; name: string; body: string; authorId: string }[];
  assert.equal(noted.length, 1);
  assert.equal(noted[0].id, n.id);
  assert.equal(noted[0].name, "Jeff");
  assert.equal(noted[0].authorId, ctx.uid);
  // release-level artwork, kind guessed from the name, no track
  const art = await cmd("releases.files.attach", { releaseId: id, files: [{ driveFileId: "fake-release-cover" }] });
  const cover = (await db.get("files", art.ids[0]))!;
  assert.equal(cover.kind, "artwork");
  assert.equal(cover.releaseTrackId, undefined);
  await code(cmd("releases.files.note", { id: "nope", body: "x" }), "not_found");
  await code(cmd("releases.files.attach", { releaseId: id, trackId: "nope", files: [{ url: "https://x.test/a" }] }), "not_found");

  // money on the track: the expense must be on the release's project
  const release = (await db.get("releases", id))!;
  const e = await cmd("expenses.add", { amount: 30000, what: "Mix v2 revisions", category: "mixing", projectId: release.projectId, releaseTrackId: track.id, payBack: false });
  assert.equal((await db.get("expenses", e.id))!.releaseTrackId, track.id);
  await code(cmd("expenses.add", { amount: 100, what: "x", category: "mixing", releaseTrackId: track.id }), "invalid_input");
  await code(cmd("expenses.add", { amount: 100, what: "x", category: "mixing", projectId: release.projectId, releaseTrackId: "nope" }), "not_found");
  const inc = await cmd("income.add", { amount: 50000, category: "preorders", from: "Bandcamp", projectId: release.projectId });
  assert.equal((await db.get("income", inc.id))!.category, "preorders");
  // a payout pins to a track the same way (a session player's pay for one song), and can be moved off it
  const pay = await cmd("payouts.add", { to: { name: "Ava Strings" }, kind: "pay", amount: 20000, what: "cello on Low Light", projectId: release.projectId, releaseTrackId: track.id });
  assert.equal((await db.get("payouts", pay.id))!.releaseTrackId, track.id);
  await code(cmd("payouts.add", { to: { name: "Ava Strings" }, kind: "pay", amount: 100, projectId: release.projectId, releaseTrackId: "nope" }), "not_found");
  await cmd("payouts.update", { id: pay.id, patch: { releaseTrackId: null } });
  assert.equal((await db.get("payouts", pay.id))!.releaseTrackId, undefined);

  // the song's own files are untouched by the release; removing the release archives its tracks and files and closes the project
  await db.create(ctx, "files", { kind: "demo", title: "Low Light demo", songId: songs[2], url: "https://x.test/demo", provider: "web", checkedAt: new Date() });
  await cmd("releases.remove", { id });
  assert.ok((await db.get("releases", id))!.deletedAt);
  assert.equal((await db.list(`releases/${id}/tracks`)).length, 0);
  assert.deepEqual((await db.list("files")).map((f) => f.title), ["Low Light demo"]);
  assert.equal((await db.get("projects", release.projectId))!.status, "closed");
  await code(cmd("releases.tracks.add", { releaseId: id, songIds: [songs[0]] }), "not_found");
});

test("members read releases but can't change them; the member role gets no release commands", async () => {
  const { id } = await cmd("releases.create", { title: "LP", songIds: [songs[0]] });
  assert.ok(await db.get("releases", id));
  for (const n of Object.keys(registry).filter((n) => n.startsWith("releases."))) assert.ok(!registry[n].roles.includes("member"), n);
  void mctx;
});

test("Roadie: releases are a tool group, search finds them, the cards read plainly, help explains the pages", async () => {
  assert.ok(groupsFor("add Big River to the release", [], undefined).includes("releases"));
  assert.ok(groupsFor("we spent $400 on mastering", [], undefined).includes("releases"));
  assert.ok(groupsFor("what's for dinner", [], { route: "release", params: { id: "x" } } as never).includes("releases"));
  assert.ok(!groupsFor("book the Hi-Dive", [], undefined).includes("releases"));
  const { id } = await cmd("releases.create", { title: "Wild Hearts LP", songIds: [songs[0]] });
  const hits = await searchAll(ctx, { q: "wild hearts" });
  assert.deepEqual(hits.results.map((r) => [r.kind, r.id]), [["release", id]]);
  assert.equal((await cmd("records.get", { kind: "releases", id })).title, "Wild Hearts LP");
  assert.equal(summarize("releases.create", { title: "Wild Hearts LP", kind: "album", setlistId: "s" }), "Start the album Wild Hearts LP, with its own money project and a tracklist");
  assert.equal(summarize("releases.tracks.add", { releaseId: id, songIds: ["a", "b"] }, undefined, { title: "Wild Hearts LP" }), "Put 2 songs on the release Wild Hearts LP");
  assert.equal(summarize("releases.files.approve", { id: "f", approved: true }, undefined, { title: "Mix v4" }), "Sign off Mix v4: the track moves on");
  assert.ok(needsConfirm("releases.remove", { id }));
  assert.ok(needsConfirm("releases.files.copyToFolder", { releaseId: id, ids: ["a"] }));
  assert.ok(!needsConfirm("releases.tracks.add", { releaseId: id, songIds: ["a", "b", "c", "d", "e", "f", "g"] }));
  assert.ok(!needsConfirm("releases.create", { title: "x", songIds: ["a", "b", "c", "d", "e", "f", "g"] }));
  assert.equal(topicForPage("releases")?.id, "releases");
  assert.equal(topicForPage("release")?.id, "releasePage");
  assert.equal(topicForPage("release", "money")?.id, "releaseMoney");
  assert.equal(topicForPage("release", "files")?.id, "releaseFiles");
  assert.equal(topicForPage("releaseTrack")?.id, "releaseTrack");
  assert.equal(topicInWords("how do I approve a mix?")?.id, "releaseTrack");
  assert.equal(topicInWords("what's on the release page")?.id, "releasePage");
});

test("migrate-releases: old albums docs, albumId fields, project kinds and menu prefs move to the release names; dry run writes nothing; second run is a no-op", async () => {
  const fs = firestore();
  await fs.doc("albums/a1").set({ artistId: TEST_ARTIST, title: "Old LP", kind: "album", status: "mixing", projectId: "p1" });
  await fs.doc("albums/a1/tracks/t1").set({ songId: songs[0], position: 1, status: "mixed" });
  await fs.doc("projects/p1").set({ artistId: TEST_ARTIST, kind: "album", name: "Old LP", status: "open" });
  await fs.doc("files/f1").set({ artistId: TEST_ARTIST, kind: "mix", albumId: "a1", albumTrackId: "t1", name: "v1.wav" });
  await fs.doc("expenses/e1").set({ artistId: TEST_ARTIST, projectId: "p1", albumTrackId: "t1", amount: 100 });
  await fs.doc("userPrefs/u1").set({ uid: "u1", hiddenSections: ["albums", "fans"], order: ["money", "albums"] });

  const dry = await migrateReleases(fs, { dryRun: true });
  assert.deepEqual(dry, { releases: 1, tracks: 1, fields: 3, projects: 1, prefs: 1 });
  assert.ok((await fs.doc("albums/a1").get()).exists, "dry run moves nothing");

  assert.deepEqual(await migrateReleases(fs), { releases: 1, tracks: 1, fields: 3, projects: 1, prefs: 1 });
  assert.equal((await fs.doc("albums/a1").get()).exists, false);
  assert.equal((await fs.doc("albums/a1/tracks/t1").get()).exists, false);
  assert.equal((await fs.doc("releases/a1").get()).get("title"), "Old LP");
  assert.equal((await fs.doc("releases/a1/tracks/t1").get()).get("status"), "mixed");
  assert.equal((await fs.doc("projects/p1").get()).get("kind"), "release");
  const f = (await fs.doc("files/f1").get()).data()!;
  assert.deepEqual([f.releaseId, f.releaseTrackId, f.albumId, f.albumTrackId], ["a1", "t1", undefined, undefined]);
  assert.equal((await fs.doc("expenses/e1").get()).get("releaseTrackId"), "t1");
  const u = (await fs.doc("userPrefs/u1").get()).data()!;
  assert.deepEqual([u.hiddenSections, u.order], [["releases", "fans"], ["money", "releases"]]);
  assert.deepEqual(await migrateReleases(fs), { releases: 0, tracks: 0, fields: 0, projects: 0, prefs: 0 });
});
