import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { driveClient } from "@/server/integrations";
import { demosFolderId, folderForRehearsal, rehearsalFolderId, songwritingFolderId } from "@/server/music";
import { guessKey, guessKind, lastRehearsed, move, parseLen, fmtLen, playerFor, playsInline, setlistSlack, setlistTotal } from "@/lib/music";
import { resetEmulators, makeUser, venue } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx;
let ids: Record<string, string>;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.DRIVE_BASE_URL = s.running["fake-drive"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};

beforeEach(async () => {
  await resetEmulators();
  await fetch(process.env.DRIVE_BASE_URL + "/__reset", { method: "POST" });
  const u = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  ctx = { uid: u.uid, role: "admin", via: "app", runId: newRunId() };
  ids = {};
  for (const k of ["ingrid", "jeff", "david", "eric", "emma"]) {
    ids[k] = (await db.create(ctx, "musicians", { name: k, instruments: [], active: true, email: `${k}@example.com` })).id;
  }
  ids.sam = (await db.create(ctx, "musicians", { name: "sam", instruments: [], active: true })).id; // no email: not a "member" for sharing
  ids.gone = (await db.create(ctx, "musicians", { name: "gone", instruments: [], active: false, email: "gone@example.com" })).id;
  await db.create(ctx, "artists", { name: "Band", slug: "band", driveFolderId: "fake-band-folder", chartsFolderId: "fake-folder-charts", links: {}, configurations: [] });
});

test("pure helpers: kinds, keys, lengths, player choice, last rehearsed", () => {
  assert.equal(guessKind("Glass Coast chart F#m.docx"), "chart");
  assert.equal(guessKind("Glass Coast lyrics"), "lyrics");
  assert.equal(guessKind("Rehearsal 2026-10-18 full run.wav", "audio/wav"), "rehearsal");
  assert.equal(guessKind("Glass Coast demo v3.m4a", "audio/mp4"), "demo");
  assert.equal(guessKind("Glass Coast live Roots.mp4", "video/mp4"), "recording");
  assert.equal(guessKey("Glass Coast chart F#m.docx"), "F#m");
  assert.equal(guessKey("Weathervane chart d.docx"), "D");
  assert.equal(guessKey("Weathervane demo.m4a"), undefined);
  assert.equal(parseLen("3:52"), 232);
  assert.equal(parseLen("232"), 232);
  assert.equal(parseLen("abc"), undefined);
  assert.equal(fmtLen(232), "3:52");
  assert.deepEqual(move([1, 2, 3, 4], 0, 2), [2, 3, 1, 4]);
  assert.deepEqual(move([1, 2], 0, 5), [1, 2]);
  assert.equal(setlistTotal([{ lengthSec: 60 }, {}, { lengthSec: 30 }]), 90);
  assert.equal(setlistSlack(2400, 2700), 300);
  assert.equal(setlistSlack(3000, 2700), -300);
  assert.equal(playerFor({ url: "https://x.test/a.mp3", mimeType: "audio/mpeg" }).mode, "audio");
  assert.equal(playerFor({ url: "https://x.test/a.mp4", mimeType: "video/mp4" }).mode, "video");
  assert.deepEqual(playerFor({ url: "https://drive.google.com/file/d/abc/view?usp=sharing", mimeType: "audio/mp4" }), { mode: "embed", src: "https://drive.google.com/file/d/abc/preview" });
  assert.equal(playerFor({ url: "http://localhost:3202/files/fake-drive-demo-1", mimeType: "audio/mp4" }).mode, "link");
  assert.equal(playerFor({ url: "https://x.test/a.mp3", mimeType: "application/pdf" }).mode, "link");
  // The inline player takes any Drive audio (it streams through the app) and direct audio links; not video, not other links.
  assert.equal(playsInline({ url: "http://localhost:3202/files/fake-drive-demo-1", mimeType: "audio/mp4", driveFileId: "fake-drive-demo-1" }), true);
  assert.equal(playsInline({ url: "https://x.test/a.mp3", mimeType: "audio/mpeg" }), true);
  assert.equal(playsInline({ url: "https://x.test/listen", mimeType: "audio/mpeg" }), false);
  assert.equal(playsInline({ url: "https://x.test/a.mp4", mimeType: "video/mp4", driveFileId: "x" }), false);
  assert.deepEqual(lastRehearsed([{ date: "2026-10-04", songs: [{ songId: "a" }] }, { date: "2026-10-18", songs: [{ songId: "a" }, { songId: "b" }] }]), { a: "2026-10-18", b: "2026-10-18" });
});

test("drive.search returns audio/video/Docs/Word with who can't open each", async () => {
  const r = await cmd("drive.search", { q: "Sundial" });
  const names = r.files.map((f: any) => f.name).sort();
  assert.deepEqual(names, ["Sundial chart Bb.docx", "Sundial demo.m4a", "Sundial lyrics"]); // no pdf
  const lyrics = r.files.find((f: any) => f.name === "Sundial lyrics");
  assert.equal(lyrics.inBandFolder, false);
  assert.deepEqual([...lyrics.missing].sort(), [ids.david, ids.eric].sort()); // ingrid owns it, jeff + emma have it; sam (no email) and the inactive one are not members
  const demo = r.files.find((f: any) => f.name === "Sundial demo.m4a");
  assert.equal(demo.inBandFolder, true);
  assert.deepEqual(demo.missing, []);
  assert.equal(demo.kind, "demo");
  assert.equal(r.files.find((f: any) => f.name.includes("chart")).key, "Bb");
});

test("songs.create attaches picked files with kind, key, owner, inBandFolder and sharing", async () => {
  const hits = (await cmd("drive.search", { q: "Sundial" })).files as any[];
  const pick = hits.filter((f) => f.name !== "Sundial demo.m4a");
  const { id, fileIds } = await cmd("songs.create", { title: "Sundial", key: "Bb", lengthSec: 198, status: "active", files: pick.map((f) => ({ driveFileId: f.driveFileId, kind: f.kind, key: f.key ?? undefined })) });
  assert.equal(fileIds.length, 2);
  const files = await db.list("files", (q) => q.where("songId", "==", id));
  const chart = files.find((f) => f.kind === "chart")!;
  assert.equal(chart.key, "Bb");
  assert.equal(chart.ownerEmail, "ingrid@example.com");
  assert.equal(chart.inBandFolder, true); // charts live in the Charts folder inside the band folder
  assert.equal(chart.sharing, "ok");
  const lyrics = files.find((f) => f.kind === "lyrics")!;
  assert.equal(lyrics.inBandFolder, false);
  assert.deepEqual([...lyrics.sharing.missing].sort(), [ids.david, ids.eric].sort());
  assert.ok(lyrics.checkedAt);
  // attaching the same file again is skipped, not duplicated
  const again = await cmd("files.attach", { songId: id, files: [{ driveFileId: lyrics.driveFileId }] });
  assert.equal(again.skipped, 1);
  assert.equal((await db.list("files", (q) => q.where("songId", "==", id))).length, 2);
  // a bad Drive id fails the whole command, nothing written
  await assert.rejects(cmd("songs.create", { title: "Nope", status: "idea", files: [{ driveFileId: "does-not-exist" }] }), /not found/i);
  assert.equal((await db.list("songs")).filter((s) => s.title === "Nope").length, 0);
});

test("files.attach needs a song, a rehearsal or both; both is a song's take at that rehearsal", async () => {
  await assert.rejects(cmd("files.attach", { files: [{ driveFileId: "fake-demo-2" }] }));
  await assert.rejects(cmd("files.attach", { songId: "a", rehearsalId: "b", files: [{ driveFileId: "fake-demo-2" }] }), { code: "not_found" });
  const song = await cmd("songs.create", { title: "Weathervane", status: "active" });
  const reh = await cmd("rehearsals.create", { date: "2026-10-20", songs: [{ songId: song.id }] });
  await cmd("files.attach", { songId: song.id, rehearsalId: reh.id, files: [{ driveFileId: "fake-demo-2" }] });
  const [f] = await db.list("files");
  assert.deepEqual([f.songId, f.rehearsalId, f.kind], [song.id, reh.id, "rehearsal"]);
  // the same file on the song alone is a different attachment; the same pair again is skipped
  assert.equal((await cmd("files.attach", { songId: song.id, rehearsalId: reh.id, files: [{ driveFileId: "fake-demo-2" }] })).skipped, 1);
});

test("rehearsal recordings: a folder already named with the date is reused, otherwise \"{date} Rehearsal\" is made; uploads land in it", async () => {
  const drive = driveClient();
  const parent = (await drive.createFolder("Demos", "fake-band-folder")).id;
  const handMade = await drive.createFolder("2026-09-29 - Rehearsal", parent);
  await drive.createFolder("2026-10-13", parent);
  assert.equal((await folderForRehearsal(drive, parent, "2026-09-29")).id, handMade.id);
  const made = await folderForRehearsal(drive, parent, "2026-10-26");
  assert.deepEqual([made.name, made.parents], ["2026-10-26 Rehearsal", [parent]]);
  assert.equal((await folderForRehearsal(drive, parent, "2026-10-26")).id, made.id, "made once, then reused");
  const up = await drive.upload({ name: "Animal - 2026-10-26 Rehearsal.m4a", mimeType: "audio/mp4", parentId: made.id, data: new Blob(["x"]) });
  assert.deepEqual([up.name, up.mimeType, up.parents], ["Animal - 2026-10-26 Rehearsal.m4a", "audio/mp4", [made.id]]);

  const artistId = (await db.list("artists"))[0].id;
  const a: Ctx = { ...ctx, artistId };
  assert.equal((await cmd("google.status", {}, a)).rehearsalFolder, null);
  const set = await cmd("google.setRehearsalFolder", { folder: `https://drive.google.com/drive/folders/${parent}` }, a);
  assert.equal(set.rehearsalFolder.name, "Demos");
  assert.equal(await rehearsalFolderId(artistId), parent);
  assert.throws(() => registry["artists.update"].input.parse({ id: artistId, patch: { rehearsalFolderId: "x" } }), "only google.setRehearsalFolder sets it");
});

test("sharing check, share with band, copy to band folder (against fake-drive)", async () => {
  const { id: songId } = await cmd("songs.create", { title: "Sundial", status: "active", files: [{ driveFileId: "fake-lyrics-5" }, { driveFileId: "fake-demo-2" }] });
  const [lyrics] = await db.list("files", (q) => q.where("driveFileId", "==", "fake-lyrics-5"));
  const [demo] = await db.list("files", (q) => q.where("driveFileId", "==", "fake-demo-2"));
  assert.ok(songId);
  assert.notEqual(lyrics.sharing, "ok");
  assert.notEqual(demo.sharing, "ok"); // fake-demo-2 is not shared with emma

  // someone fixes it in Drive outside the app; the check notices
  await driveClient().share("fake-demo-2", ["emma@example.com"]);
  const r = await cmd("files.check", {});
  assert.equal(r.checked, 2);
  assert.equal(r.withGaps, 1);
  assert.equal(r.outsideBandFolder, 1);
  const demo2 = (await db.get("files", demo.id))!;
  assert.equal(demo2.sharing, "ok");
  assert.ok(demo2.checkedAt.toMillis() >= demo.checkedAt.toMillis());

  // Share with band: owner stays, only missing people are added
  const s = await cmd("files.shareWithBand", { ids: [lyrics.id] });
  assert.equal(s.fixed, 1);
  const perms = await driveClient().permissions("fake-lyrics-5");
  for (const e of ["david", "eric", "emma", "ingrid", "jeff"]) assert.ok(perms.some((p) => p.email === `${e}@example.com`), e);
  assert.ok(!perms.some((p) => p.email === "gone@example.com"));
  const l2 = (await db.get("files", lyrics.id))!;
  assert.equal(l2.sharing, "ok");
  assert.equal(l2.inBandFolder, false); // sharing alone doesn't move it

  // Copy to band folder: the copy goes in the Charts folder, and the doc now points at it
  const c = await cmd("files.copyToBand", { ids: [lyrics.id] });
  assert.equal(c.fixed, 1);
  const l3 = (await db.get("files", lyrics.id))!;
  assert.notEqual(l3.driveFileId, "fake-lyrics-5");
  assert.equal(l3.inBandFolder, true);
  assert.equal(l3.sharing, "ok");
  const copy = await driveClient().get(l3.driveFileId);
  assert.deepEqual(copy.parents, ["fake-folder-charts"]);
  assert.equal(l3.url, copy.webViewLink);
  // second copy is a no-op
  assert.equal((await cmd("files.copyToBand", { ids: [lyrics.id] })).fixed, 0);

  // a file that vanished from Drive is reported, not fatal
  await db.update(ctx, "files", demo.id, { driveFileId: "gone-from-drive" });
  const r2 = await cmd("files.check", {});
  assert.equal(r2.errors.length, 1);
  assert.equal(r2.checked, 1);
});

test("setlist templates and show setlists: totalSec computed, song data copied, rename keeps titles in sync in both", async () => {
  const a = (await cmd("songs.create", { title: "Glass Coast", key: "F#m", lengthSec: 232, status: "active" })).id;
  const b = (await cmd("songs.create", { title: "Weathervane", key: "D", lengthSec: 250, status: "active" })).id;
  const noLen = (await cmd("songs.create", { title: "Idea", status: "idea" })).id;
  const { id } = await cmd("setlistTemplates.create", { name: "Hi-Dive 45", items: [{ type: "song", songId: a, title: "ignored" }, { type: "break", title: "Talk / tune" }, { type: "song", songId: b }, { type: "song", songId: noLen }] });
  let sl = (await db.get("setlistTemplates", id))!;
  assert.equal(sl.name, "Hi-Dive 45");
  assert.equal(sl.totalSec, 232 + 60 + 250);
  assert.equal(sl.items[0].title, "Glass Coast");
  assert.equal(sl.items[1].lengthSec, 60);

  // reorder + remove: total follows
  await cmd("setlistTemplates.update", { id, patch: { items: [{ type: "song", songId: b }, { type: "song", songId: a }] } });
  sl = (await db.get("setlistTemplates", id))!;
  assert.deepEqual(sl.items.map((i: any) => i.title), ["Weathervane", "Glass Coast"]);
  assert.equal(sl.totalSec, 482);

  // a show's setlist lives at setlists/{showId}: no name, no showId field, no pointer on the show
  const v = (await cmd("venues.create", venue("Hi-Dive"))).id;
  const p = (await cmd("pitches.flag", { kind: "venue", id: v })).id;
  const showId = (await cmd("shows.create", { pitchId: p, date: "2027-01-16", venueId: v, times: { set: "20:00", setLengthSec: 2700 }, needs: { poster: false, backline: false, merch: false } })).id as string;
  await cmd("setlists.setItems", { showId, items: [{ type: "song", songId: b }, { type: "song", songId: a }] });
  let ss = (await db.get("setlists", showId))!;
  assert.equal(ss.totalSec, 482);
  assert.equal(ss.name, undefined);
  assert.equal(ss.showId, undefined);
  assert.equal((await db.get("shows", showId))!.setlistId, undefined);

  // renaming a song and changing its length flows into both the template and the show's setlist
  await cmd("songs.update", { id: a, patch: { title: "Glass Coast (radio)", lengthSec: 200 } });
  sl = (await db.get("setlistTemplates", id))!;
  assert.equal(sl.items[1].title, "Glass Coast (radio)");
  assert.equal(sl.totalSec, 450);
  ss = (await db.get("setlists", showId))!;
  assert.equal(ss.items[1].title, "Glass Coast (radio)");
  assert.equal(ss.totalSec, 450);

  await assert.rejects(cmd("setlistTemplates.update", { id, patch: { items: [{ type: "song", songId: "nope" }] } }), /not found/i);
  await assert.rejects(cmd("setlistTemplates.create", { name: "x", items: [{ type: "song" }] }));
  await assert.rejects(cmd("setlists.setItems", { showId: "nope", items: [] }), /not found/i);

  // clearing archives it; setting items again brings the same doc back
  await cmd("setlists.remove", { showId });
  assert.ok((await db.get("setlists", showId))!.deletedAt);
  await cmd("setlists.setItems", { showId, items: [{ type: "song", songId: b }] });
  ss = (await db.get("setlists", showId))!;
  assert.ok(!ss.deletedAt);
  assert.equal(ss.totalSec, 250);
});

test("setlists.seed: from a template or another show, replace or append, records the source", async () => {
  const a = (await cmd("songs.create", { title: "Glass Coast", lengthSec: 200, status: "active" })).id;
  const b = (await cmd("songs.create", { title: "Weathervane", lengthSec: 250, status: "active" })).id;
  const t = (await cmd("setlistTemplates.create", { name: "Hi-Dive 45", items: [{ type: "song", songId: a }, { type: "break" }, { type: "song", songId: b }] })).id;
  const v = (await cmd("venues.create", venue("Hi-Dive"))).id;
  const mk = async (date: string) => {
    const p = (await cmd("pitches.flag", { kind: "venue", id: v })).id;
    return (await cmd("shows.create", { pitchId: p, date, venueId: v, times: { set: "20:00", setLengthSec: 2700 }, needs: { poster: false, backline: false, merch: false } })).id as string;
  };
  const s1 = await mk("2027-01-16");
  const s2 = await mk("2027-02-20");

  // from a template (replace is the default)
  const out = await cmd("setlists.seed", { showId: s1, from: { kind: "template", id: t } });
  assert.deepEqual(out, { showId: s1, added: 3, total: 3 });
  let sl = (await db.get("setlists", s1))!;
  assert.deepEqual(sl.items.map((i: any) => i.type), ["song", "break", "song"]);
  assert.equal(sl.items[0].title, "Glass Coast");
  assert.equal(sl.totalSec, 200 + 60 + 250);
  assert.deepEqual(sl.source, { kind: "template", id: t, name: "Hi-Dive 45" });

  // later edits to the template don't touch the copy
  await cmd("setlistTemplates.update", { id: t, patch: { items: [{ type: "song", songId: b }] } });
  assert.equal(((await db.get("setlists", s1))!.items as unknown[]).length, 3);

  // from another show; append keeps what was there, replace swaps it
  await cmd("setlists.setItems", { showId: s2, items: [{ type: "song", songId: b }] });
  const app = await cmd("setlists.seed", { showId: s2, from: { kind: "show", id: s1 }, mode: "append" });
  assert.deepEqual(app, { showId: s2, added: 3, total: 4 });
  sl = (await db.get("setlists", s2))!;
  assert.equal(sl.items[0].songId, b);
  assert.equal(sl.items.length, 4);
  assert.equal(sl.source.kind, "show");
  assert.equal(sl.source.id, s1);
  const rep = await cmd("setlists.seed", { showId: s2, from: { kind: "show", id: s1 }, mode: "replace" });
  assert.deepEqual(rep, { showId: s2, added: 3, total: 3 });

  await assert.rejects(cmd("setlists.seed", { showId: s1, from: { kind: "template", id: "nope" } }), /not found/i);
  await assert.rejects(cmd("setlists.seed", { showId: s1, from: { kind: "show", id: "nope" } }), /no setlist/i);
  await assert.rejects(cmd("setlists.seed", { showId: "nope", from: { kind: "template", id: t } }), /not found/i);
});

test("setlists: a song still in the Writing phase can't be added; one already on the list stays; seeding skips it", async () => {
  const a = (await cmd("songs.create", { title: "Glass Coast", status: "active" })).id;
  const w = (await cmd("songs.create", { title: "Halfway Home", status: "writing" })).id;
  const v = (await cmd("venues.create", venue("Hi-Dive"))).id;
  const p = (await cmd("pitches.flag", { kind: "venue", id: v })).id;
  const show = (await cmd("shows.create", { pitchId: p, date: "2027-01-16", venueId: v, times: { set: "20:00", setLengthSec: 2700 }, needs: { poster: false, backline: false, merch: false } })).id;

  await assert.rejects(cmd("setlists.setItems", { showId: show, items: [{ type: "song", songId: w }] }), /still being written/);
  await assert.rejects(cmd("setlistTemplates.create", { name: "T", items: [{ type: "song", songId: w }] }), /still being written/);

  // on the list while Playing, then moved back to Writing: the list can still be saved with it
  await cmd("songs.update", { id: w, patch: { status: "active" } });
  const t = (await cmd("setlistTemplates.create", { name: "T", items: [{ type: "song", songId: a }, { type: "song", songId: w }] })).id;
  await cmd("setlists.setItems", { showId: show, items: [{ type: "song", songId: w }] });
  await cmd("songs.update", { id: w, patch: { status: "writing" } });
  await cmd("setlists.setItems", { showId: show, items: [{ type: "song", songId: a }, { type: "song", songId: w }] });
  await cmd("setlistTemplates.update", { id: t, patch: { items: [{ type: "song", songId: w }, { type: "song", songId: a }] } });

  // seeding a show from that template leaves the Writing song out
  const p2 = (await cmd("pitches.flag", { kind: "venue", id: v })).id;
  const show2 = (await cmd("shows.create", { pitchId: p2, date: "2027-02-20", venueId: v, times: { set: "20:00", setLengthSec: 2700 }, needs: { poster: false, backline: false, merch: false } })).id;
  assert.deepEqual(await cmd("setlists.seed", { showId: show2, from: { kind: "template", id: t } }), { showId: show2, added: 1, total: 1 });
  assert.equal((await db.get("setlists", show2))!.items[0].songId, a);
});

test("rehearsals: import songs from a setlist template (append and replace, breaks skipped); set and clear the location", async () => {
  const a = (await cmd("songs.create", { title: "Glass Coast", status: "active" })).id;
  const b = (await cmd("songs.create", { title: "Ruby Hill", status: "active" })).id;
  const c = (await cmd("songs.create", { title: "Weathervane", status: "active" })).id;
  const sl = (await cmd("setlistTemplates.create", { name: "Hi-Dive", items: [
    { type: "song", songId: a, note: "capo 2" }, { type: "break" }, { type: "song", songId: b }, { type: "song", songId: c },
  ] })).id;
  const { id } = await cmd("rehearsals.create", { date: "2026-10-29", songs: [{ songId: c, note: "run twice" }] });

  const imp = await cmd("rehearsals.importSetlist", { id, templateId: sl, songIds: [a, b] });
  assert.equal(imp.added, 2);
  assert.equal(imp.total, 3);
  let r = (await db.get("rehearsals", id)) as any;
  assert.deepEqual(r.songs.map((s: any) => s.title), ["Weathervane", "Glass Coast", "Ruby Hill"]); // append keeps what was there
  assert.equal(r.fromSetlistId, sl);
  assert.equal(r.songs[0].note, "run twice");

  await cmd("rehearsals.importSetlist", { id, templateId: sl, songIds: [a, c], mode: "replace" });
  r = (await db.get("rehearsals", id)) as any;
  assert.deepEqual(r.songs.map((s: any) => s.title), ["Glass Coast", "Weathervane"]);

  // later edits to the setlist don't touch the rehearsal
  await cmd("setlistTemplates.update", { id: sl, patch: { items: [{ type: "song", songId: b }] } });
  r = (await db.get("rehearsals", id)) as any;
  assert.deepEqual(r.songs.map((s: any) => s.title), ["Glass Coast", "Weathervane"]);

  const loc = { name: "The Loft", address: "2363 Champa St, Denver, CO, USA", lat: 39.7526, lng: -104.9868 };
  await cmd("rehearsals.setLocation", { id, location: loc });
  assert.deepEqual(((await db.get("rehearsals", id)) as any).location, loc);
  await cmd("rehearsals.setLocation", { id, location: null });
  assert.equal(((await db.get("rehearsals", id)) as any).location, undefined);
});

test("rehearsals: log with songs and notes, attach a recording, last rehearsed, rename sync", async () => {
  const a = (await cmd("songs.create", { title: "Glass Coast", status: "active" })).id;
  const b = (await cmd("songs.create", { title: "Ruby Hill", status: "active" })).id;
  const { id, fileIds } = await cmd("rehearsals.create", {
    date: "2026-10-18", location: { name: "Jeff's basement" }, personnel: [ids.ingrid, ids.jeff], songs: [{ songId: a, note: "Tighten the bridge" }, { songId: b }],
    files: [{ driveFileId: "fake-reh-1" }],
  });
  assert.equal(fileIds.length, 1);
  const f = (await db.list("files", (q) => q.where("rehearsalId", "==", id)))[0];
  assert.equal(f.kind, "rehearsal");
  assert.equal(f.songId, undefined);
  const r = (await db.get("rehearsals", id))!;
  assert.deepEqual(r.songs.map((s: any) => s.title), ["Glass Coast", "Ruby Hill"]);
  await cmd("rehearsals.create", { date: "2026-10-04", songs: [{ songId: a }] });
  const last = lastRehearsed((await db.list("rehearsals")) as any);
  assert.equal(last[a], "2026-10-18");
  assert.equal(last[b], "2026-10-18");

  await cmd("rehearsals.update", { id, patch: { songs: [{ songId: a }], notes: "short night" } });
  assert.equal((await db.get("rehearsals", id))!.songs.length, 1);
  await cmd("songs.update", { id: a, patch: { title: "Glass Coast v2" } });
  assert.equal((await db.get("rehearsals", id))!.songs[0].title, "Glass Coast v2");

  await cmd("files.attach", { rehearsalId: id, files: [{ driveFileId: "fake-reh-3" }] });
  assert.equal((await db.list("files", (q) => q.where("rehearsalId", "==", id))).length, 2);
  await cmd("rehearsals.remove", { id });
  assert.equal((await db.list("files", (q) => q.where("rehearsalId", "==", id))).length, 0);
});

test("only admins (or mcp) may write Music; members have no write commands", () => {
  // rehearsals.setExpenses is Money, not Music: members enter their own expense lines, like shows.setExpenses
  // printing is a read plus personal prefs: members print too
  const memberOk = new Set(["rehearsals.setExpenses", "setlists.printLink", "setlists.printPrefs", "setlists.setPrintPrefs"]);
  for (const [name, c] of Object.entries(registry)) {
    if (/^(songs|files|setlists|rehearsals|drive)\./.test(name) && !memberOk.has(name)) assert.ok(!c.roles.includes("member"), name);
  }
});

test("drive.fix copies or shares before anything is attached", async () => {
  const s = await cmd("drive.fix", { driveFileIds: ["fake-lyrics-5"], fix: "share" });
  assert.deepEqual(s.files[0].missing, []);
  assert.equal(s.files[0].inBandFolder, false);
  assert.equal(s.files[0].driveFileId, "fake-lyrics-5");
  const c = await cmd("drive.fix", { driveFileIds: ["fake-lyrics-5"], fix: "copy" });
  assert.notEqual(c.files[0].driveFileId, "fake-lyrics-5");
  assert.equal(c.files[0].inBandFolder, true);
  assert.deepEqual(c.files[0].missing, []);
  await assert.rejects(cmd("drive.fix", { driveFileIds: ["nope"], fix: "share" }), /nope/);
});

test("a musician added after seeding: gap never blocks attach, share adds their permission, no-email people are never counted", async () => {
  const foo = (await db.create(ctx, "musicians", { name: "Foo", instruments: [], active: true, email: "Foo@Example.com" })).id;
  const hit = ((await cmd("drive.search", { q: "Cottonwood" })).files as any[]).find((f) => f.name === "Cottonwood demo.m4a");
  assert.deepEqual(hit.missing, [foo]); // Foo only: Sam (no email) and the inactive one are not counted
  const song = (await db.create(ctx, "songs", { title: "Cottonwood", status: "active" } as any)).id;
  const att = await cmd("files.attach", { songId: song, files: [{ driveFileId: hit.driveFileId, kind: "demo" }] });
  assert.equal(att.ids.length, 1); // attaching with a sharing gap goes through
  assert.deepEqual((await db.list("files"))[0].sharing, { missing: [foo] });
  const fix = await cmd("drive.fix", { driveFileIds: [hit.driveFileId], fix: "share" });
  assert.deepEqual(fix.files[0].missing, []);
  const perms = (await driveClient().get(hit.driveFileId)).permissions.map((p) => p.email);
  assert.ok(perms.includes("foo@example.com"));
  assert.deepEqual(((await cmd("drive.search", { q: "Cottonwood" })).files as any[]).find((f) => f.name === "Cottonwood demo.m4a").missing, []);
});

test("band folder: chosen on Settings > Google by search or link; until then nothing is in it", async () => {
  const artistId = (await db.list("artists"))[0].id;
  const a: Ctx = { ...ctx, artistId };
  await db.update(ctx, "artists", artistId, { driveFolderId: "", chartsFolderId: null });
  const song = await cmd("songs.create", { title: "Glass Coast", status: "active" });
  await cmd("files.attach", { songId: song.id, files: [{ driveFileId: "fake-drive-demo-1" }] });
  const f = (await db.list("files"))[0];
  assert.equal(f.inBandFolder, false, "no folder: nothing is in it");
  await assert.rejects(cmd("files.copyToBand", { ids: [f.id] }), { code: "no_charts_folder" });
  await assert.rejects(cmd("drive.fix", { driveFileIds: ["fake-drive-demo-1"], fix: "copy" }), /tell me where the lyrics and charts should go/);
  const chk = await cmd("files.check", {});
  assert.deepEqual([chk.outsideBandFolder, chk.bandFolder], [null, false]);
  assert.equal((await cmd("songs.missingFiles", {}, a)).sharingProblems.some((p: { outsideBandFolder: boolean }) => p.outsideBandFolder), false);

  const st = await cmd("google.status", {}, a);
  assert.deepEqual([st.driveReady, st.bandFolder], [true, null], "the fake Drive is usable; no folder yet");
  const found = await cmd("google.findFolders", { q: "charts" }, a);
  assert.deepEqual(found.folders.map((x: { id: string }) => x.id), ["fake-folder-charts"], "folders only, not the chart files");

  await assert.rejects(cmd("google.setBandFolder", { folder: "fake-lyrics-5" }, a), /is a file, not a folder/);
  await assert.rejects(cmd("google.setBandFolder", { folder: "no-such-folder" }, a), { code: "not_found" });
  await assert.rejects(cmd("google.setBandFolder", { folder: "https://example.com/x y" }, a), { code: "invalid_input" });
  const set = await cmd("google.setBandFolder", { folder: "https://drive.google.com/drive/folders/fake-band-folder?usp=sharing" }, a);
  assert.equal(set.bandFolder.name, "Ingrid Avison Band");
  assert.equal((await db.get("artists", artistId))?.driveFolderId, "fake-band-folder");
  assert.equal((await cmd("files.check", {})).outsideBandFolder, 0, "the demo is in the band folder now");
  assert.throws(() => registry["artists.update"].input.parse({ id: artistId, patch: { driveFolderId: "x" } }), "only google.setBandFolder sets it");
});

test("Charts folder: chosen on Settings > Google; Copy to band folder copies into it, and is refused until it's chosen", async () => {
  const artistId = (await db.list("artists"))[0].id;
  const a: Ctx = { ...ctx, artistId };
  await db.update(ctx, "artists", artistId, { chartsFolderId: null });
  const song = await cmd("songs.create", { title: "Stray", status: "active" });
  await cmd("files.attach", { songId: song.id, files: [{ driveFileId: "fake-lyrics-5" }] });
  const f = (await db.list("files")).find((x) => x.songId === song.id)!;
  assert.equal(f.inBandFolder, false);
  await assert.rejects(cmd("files.copyToBand", { ids: [f.id] }), { code: "no_charts_folder" });
  assert.equal((await cmd("google.status", {}, a)).chartsFolder, null);

  await assert.rejects(cmd("google.setChartsFolder", { folder: "fake-lyrics-5" }, a), /is a file, not a folder/);
  const st = await cmd("google.setChartsFolder", { folder: "https://drive.google.com/drive/folders/fake-folder-charts" }, a);
  assert.equal(st.chartsFolder.name, "Charts");
  assert.equal((await db.get("artists", artistId))?.chartsFolderId, "fake-folder-charts");
  await cmd("files.copyToBand", { ids: [f.id] });
  const copied = (await db.get("files", f.id))!;
  assert.deepEqual((await driveClient().get(copied.driveFileId)).parents, ["fake-folder-charts"]);
  assert.equal(copied.inBandFolder, true);
  assert.throws(() => registry["artists.update"].input.parse({ id: artistId, patch: { chartsFolderId: "x" } }), "only google.setChartsFolder sets it");
  assert.throws(() => registry["artists.update"].input.parse({ id: artistId, patch: { calendar: { id: "x", name: "x" } } }), "only google.setCalendar sets the band calendar");
});

test("Demos folder: chosen on Settings > Google, for audio uploaded to songs", async () => {
  const artistId = (await db.list("artists"))[0].id;
  const a: Ctx = { ...ctx, artistId };
  assert.equal((await cmd("google.status", {}, a)).demosFolder, null);
  assert.equal(await demosFolderId(artistId), null);
  await assert.rejects(cmd("google.setDemosFolder", { folder: "fake-lyrics-5" }, a), /is a file, not a folder/);
  const st = await cmd("google.setDemosFolder", { folder: "https://drive.google.com/drive/folders/fake-folder-demos" }, a);
  assert.equal(st.demosFolder.name, "Demos");
  assert.equal(await demosFolderId(artistId), "fake-folder-demos");
  assert.throws(() => registry["artists.update"].input.parse({ id: artistId, patch: { demosFolderId: "x" } }), "only google.setDemosFolder sets it");
});

test("Songwriting folder: chosen on Settings > Google, for audio uploaded to Writing songs", async () => {
  const artistId = (await db.list("artists"))[0].id;
  const a: Ctx = { ...ctx, artistId };
  assert.equal((await cmd("google.status", {}, a)).songwritingFolder, null);
  assert.equal(await songwritingFolderId(artistId), null);
  await assert.rejects(cmd("google.setSongwritingFolder", { folder: "fake-lyrics-5" }, a), /is a file, not a folder/);
  const st = await cmd("google.setSongwritingFolder", { folder: "https://drive.google.com/drive/folders/fake-folder-songwriting" }, a);
  assert.equal(st.songwritingFolder.name, "Songwriting");
  assert.equal(await songwritingFolderId(artistId), "fake-folder-songwriting");
  assert.throws(() => registry["artists.update"].input.parse({ id: artistId, patch: { songwritingFolderId: "x" } }), "only google.setSongwritingFolder sets it");
});
