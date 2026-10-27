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
import { adoptRecording, ensureRehearsalFolder, newRecordings, recordingName, uploadRecording } from "@/server/recordings";
import { authenticateShortcut, createShortcutToken } from "@/server/shortcut";
import { recentRehearsals, rehearsalSongs } from "@/server/shortcutLists";
import { resetEmulators, makeUser } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx;
let artistId: string;

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
const RECORDINGS = "fake-folder-rehearsals";
const dropIn = (name: string, mimeType: string, parent: string) =>
  fetch(`${process.env.DRIVE_BASE_URL}/files`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, mimeType, parents: [parent], ownerEmail: "david@example.com" }) }).then((r) => r.json() as Promise<{ id: string }>);

beforeEach(async () => {
  await resetEmulators();
  await fetch(process.env.DRIVE_BASE_URL + "/__reset", { method: "POST" });
  const u = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  for (const k of ["ingrid", "jeff", "david"]) await db.create({ uid: u.uid, role: "admin", via: "app", runId: newRunId() }, "musicians", { name: k, instruments: [], active: true, email: `${k}@example.com` });
  artistId = (await db.create({ uid: u.uid, role: "admin", via: "app", runId: newRunId() }, "artists", { name: "Band", slug: "band", driveFolderId: "fake-band-folder", rehearsalFolderId: RECORDINGS, links: {}, configurations: [] })).id;
  // The test user belongs to TEST_ARTIST; the shortcut tests need the membership to be the artist the token names.
  await db.update({ uid: u.uid, role: "admin", via: "app", runId: newRunId() }, "users", u.uid, { artists: [{ artistId, role: "admin" }] });
  ctx = { uid: u.uid, role: "admin", artistId, via: "app", runId: newRunId() };
});

test("Drive rename keeps the id and place; recordingName follows the upload convention", async () => {
  const drive = driveClient();
  const f = await drive.rename("fake-reh-1", "Glass Coast - 2026-10-18 Rehearsal.wav");
  assert.deepEqual([f.id, f.name, f.parents], ["fake-reh-1", "Glass Coast - 2026-10-18 Rehearsal.wav", [RECORDINGS]]);
  assert.equal(recordingName("Big River", "2026-10-27", "New Recording 12.m4a"), "Big River - 2026-10-27 Rehearsal.m4a");
  assert.equal(recordingName("Big River", "2026-10-27", "memo"), "Big River - 2026-10-27 Rehearsal");
});

test("rehearsals.folder makes the rehearsal's folder once, shared with the band; without a recordings folder it says so", async () => {
  const reh = await cmd("rehearsals.create", { date: "2026-10-27" });
  const f = await cmd("rehearsals.folder", { id: reh.id });
  assert.equal(f.name, "2026-10-27 Rehearsal");
  const made = await driveClient().get(f.id);
  assert.deepEqual(made.parents, [RECORDINGS]);
  for (const e of ["ingrid", "jeff", "david"]) assert.ok(made.permissions.some((p) => p.email === `${e}@example.com`) || made.ownerEmail === `${e}@example.com`, e);
  assert.equal((await ensureRehearsalFolder(ctx, reh.id)).id, f.id, "made once, then reused");
  await db.update(ctx, "artists", artistId, { rehearsalFolderId: null });
  await assert.rejects(cmd("rehearsals.folder", { id: reh.id }), { code: "no_rehearsal_folder" });
  await assert.rejects(cmd("rehearsals.folder", { id: "nope" }), { code: "not_found" });
});

test("rehearsals.newRecordings lists audio and video dropped into the folder that isn't attached yet; adoptRecording renames, shares and attaches", async () => {
  const song = await cmd("songs.create", { title: "Big River", status: "active" });
  const other = await cmd("songs.create", { title: "Low Light", status: "active" });
  const reh = await cmd("rehearsals.create", { date: "2026-10-27", songs: [{ songId: song.id }, { songId: other.id }] });
  assert.deepEqual(await newRecordings(ctx, reh.id), { folder: null, files: [] }, "no folder yet");

  const folder = await cmd("rehearsals.folder", { id: reh.id });
  const memo = await dropIn("New Recording 12.m4a", "audio/mp4", folder.id);
  const clip = await dropIn("IMG_0421.mov", "video/quicktime", folder.id);
  await dropIn("Setlist notes", "application/vnd.google-apps.document", folder.id);
  const taken = await dropIn("Already here.m4a", "audio/mp4", folder.id);
  await cmd("files.attach", { rehearsalId: reh.id, files: [{ driveFileId: taken.id }] });

  const fresh = await cmd("rehearsals.newRecordings", { id: reh.id });
  assert.equal(fresh.folder.id, folder.id);
  assert.deepEqual(fresh.files.map((f: any) => f.name), ["New Recording 12.m4a", "IMG_0421.mov"]);

  const a = await cmd("rehearsals.adoptRecording", { id: reh.id, songId: song.id, driveFileId: memo.id });
  assert.equal(a.name, "Big River - 2026-10-27 Rehearsal.m4a");
  const inDrive = await driveClient().get(memo.id);
  assert.equal(inDrive.name, "Big River - 2026-10-27 Rehearsal.m4a");
  assert.deepEqual(inDrive.parents, [folder.id]);
  for (const e of ["ingrid", "jeff"]) assert.ok(inDrive.permissions.some((p) => p.email === `${e}@example.com`), `shared with ${e}`);
  const [doc] = await db.list("files", (q) => q.where("driveFileId", "==", memo.id));
  assert.deepEqual([doc.songId, doc.rehearsalId, doc.kind, doc.title], [song.id, reh.id, "rehearsal", "Big River - 2026-10-27 Rehearsal.m4a"]);
  assert.deepEqual((await cmd("rehearsals.newRecordings", { id: reh.id })).files.map((f: any) => f.name), ["IMG_0421.mov"], "adopted ones drop off the list");

  // a file that isn't in the rehearsal's folder can't be adopted into it; a missing song or file is a clean error
  await assert.rejects(adoptRecording(ctx, reh.id, song.id, "fake-reh-1"), { code: "invalid_input" });
  await assert.rejects(adoptRecording(ctx, reh.id, "nope", clip.id), { code: "not_found" });
  await assert.rejects(adoptRecording(ctx, reh.id, song.id, "gone"), { code: "not_found" });
});

test("uploadRecording puts the file in the rehearsal's folder under the song's name and attaches it to both", async () => {
  const song = await cmd("songs.create", { title: "Big River", status: "active" });
  const reh = await cmd("rehearsals.create", { date: "2026-10-27", songs: [{ songId: song.id }] });
  const r = await uploadRecording(ctx, reh.id, song.id, new File(["x"], "New Recording 3.m4a", { type: "audio/mp4" }));
  assert.equal(r.folder.name, "2026-10-27 Rehearsal");
  assert.equal(r.name, "Big River - 2026-10-27 Rehearsal.m4a");
  const [doc] = await db.list("files", (q) => q.where("driveFileId", "==", r.driveFileId));
  assert.deepEqual([doc.songId, doc.rehearsalId], [song.id, reh.id]);
  assert.deepEqual((await newRecordings(ctx, reh.id)).files, [], "an upload isn't 'new'");
});

test("shortcut tokens: made once per admin per artist, hashed, replaced by the next one, revocable; the Shortcut's context is that admin", async () => {
  let s = await cmd("shortcut.status", {});
  assert.equal(s.token, null);
  assert.equal(s.installUrl, null);
  assert.match(s.endpoints.upload, /\/api\/rehearsals\/\{rehearsalId\}\/recording$/);

  const first = await cmd("shortcut.createToken", {});
  assert.match(first.newToken, /^rsk_[A-Za-z0-9_-]{40,}$/);
  assert.ok(first.token.createdAt, "the status comes back with it");
  assert.equal(JSON.stringify(await db.list("shortcutTokens")).includes(first.newToken), false, "the raw token is never stored");
  const who = await authenticateShortcut(first.newToken);
  assert.deepEqual([who.uid, who.role, who.artistId, who.via], [ctx.uid, "admin", artistId, "shortcut"]);
  s = await cmd("shortcut.status", {});
  assert.ok(s.token.createdAt);
  assert.ok(s.token.lastUsedAt, "last used is stamped");

  const second = await cmd("shortcut.createToken", {});
  assert.notEqual(second.newToken, first.newToken);
  await assert.rejects(authenticateShortcut(first.newToken), (e: any) => e.status === 401 && /replaced or revoked/.test(e.message));
  await authenticateShortcut(second.newToken);
  assert.equal((await db.list("shortcutTokens")).filter((t) => !t.revokedAt).length, 1, "one live token");

  assert.equal((await cmd("shortcut.revokeToken", {})).revoked, 1);
  await assert.rejects(authenticateShortcut(second.newToken), (e: any) => e.status === 401);
  await assert.rejects(authenticateShortcut("rsk_nope"), (e: any) => e.status === 401);
  await assert.rejects(authenticateShortcut(undefined), (e: any) => e.status === 401);

  // a token of someone who is no longer an admin there stops working
  const { token } = await createShortcutToken(ctx);
  await db.update(ctx, "users", ctx.uid, { artists: [{ artistId, role: "member" }] });
  await assert.rejects(authenticateShortcut(token), (e: any) => e.status === 403);
});

test("shortcut.setInstallUrl takes an iCloud shortcut link (or null); artists.update can't set it", async () => {
  await assert.rejects(cmd("shortcut.setInstallUrl", { url: "https://example.com/x" }), { code: "invalid_input" });
  const s = await cmd("shortcut.setInstallUrl", { url: "https://www.icloud.com/shortcuts/abc123" });
  assert.equal(s.installUrl, "https://www.icloud.com/shortcuts/abc123");
  assert.equal((await cmd("shortcut.setInstallUrl", { url: null })).installUrl, null);
  assert.throws(() => registry["artists.update"].input.parse({ id: artistId, patch: { shortcutUrl: "https://www.icloud.com/shortcuts/x" } }));
});

test("the Shortcut's lists: rehearsals around today nearest first (today's first), then that rehearsal's songs, as labels + ids", async () => {
  const now = new Date("2026-10-27T20:00:00Z");
  const a = await cmd("songs.create", { title: "Big River", status: "active" });
  const b = await cmd("songs.create", { title: "Low Light", status: "active" });
  const today = await cmd("rehearsals.create", { date: "2026-10-27", location: { name: "The Loft", address: "x", lat: 1, lng: 2 }, songs: [{ songId: a.id }, { songId: b.id }, { songId: a.id }] });
  const lastWeek = await cmd("rehearsals.create", { date: "2026-10-20" });
  const next = await cmd("rehearsals.create", { date: "2026-10-30" });
  await cmd("rehearsals.create", { date: "2026-09-01" }); // too old
  await cmd("rehearsals.create", { date: "2026-11-20" }); // too far ahead
  const gone = await cmd("rehearsals.create", { date: "2026-10-26" });
  await cmd("rehearsals.remove", { id: gone.id });

  const r = await recentRehearsals({ ...ctx, now }, now);
  assert.deepEqual(r.rehearsals.labels, ["Today · Tue, Oct 27 · The Loft", "Fri, Oct 30", "Tue, Oct 20"]);
  assert.deepEqual(r.rehearsals.ids, { "Today · Tue, Oct 27 · The Loft": today.id, "Fri, Oct 30": next.id, "Tue, Oct 20": lastWeek.id });

  const s = await rehearsalSongs(ctx, today.id);
  assert.deepEqual(s.rehearsal, { id: today.id, date: "2026-10-27" });
  assert.deepEqual(s.songs.labels, ["Big River", "Low Light"]);
  assert.deepEqual(s.songs.ids, { "Big River": a.id, "Low Light": b.id });
  await assert.rejects(rehearsalSongs(ctx, gone.id), { code: "not_found" });
});
