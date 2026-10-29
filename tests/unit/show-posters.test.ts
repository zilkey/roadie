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
import { showFolderName } from "@/server/commands/showPosters";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx, mctx: Ctx;
let venueId: string;

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
  venueId = (await cmd("venues.create", venue("Hi-Dive", "Denver"))).id;
});

const create = () => cmd("shows.create", { date: "2027-01-16", venueId, times: {}, needs: { poster: true, backline: false, merch: false } });

test("pure: the show folder is named for the date and venue, with no slashes", () => {
  assert.equal(showFolderName({ date: "2027-01-16", venue: { name: "Hi-Dive" } }), "2027-01-16 Hi-Dive");
  assert.equal(showFolderName({ date: "2027-01-16", venue: { name: "The 7/10 Room" } }), "2027-01-16 The 7-10 Room");
  assert.equal(showFolderName({ date: "2027-01-16", kind: "house", hostName: "Ingrid" }), "2027-01-16 House concert · Ingrid");
});

test("Settings > Google: the Shows folder is chosen like the others and shows up in the status", async () => {
  assert.equal((await cmd("google.status", {})).showsFolder, null);
  const s = await cmd("google.setShowsFolder", { folder: "https://drive.google.com/drive/folders/fake-folder-shows" });
  assert.equal(s.showsFolder.name, "Shows");
  assert.equal((await db.get("artists", TEST_ARTIST))!.showsFolderId, "fake-folder-shows");
  await code(cmd("google.setShowsFolder", { folder: "fake-reh-1" }), "invalid_input"); // a file, not a folder
  await code(cmd("google.setShowsFolder", { folder: "nope-nope" }), "not_found");
});

test("shows.folder needs the Shows folder, then makes \"{date} {venue}\" inside it once, shared with the band, and remembers it on the show", async () => {
  const { id } = await create();
  await code(cmd("shows.folder", { id }), "no_shows_folder");
  await cmd("google.setShowsFolder", { folder: "fake-folder-shows" });
  const f = await cmd("shows.folder", { id }, mctx); // a member can
  assert.equal(f.name, "2027-01-16 Hi-Dive");
  const drive = driveClient({ artistId: TEST_ARTIST });
  const made = await drive.get(f.id);
  assert.deepEqual(made.parents, ["fake-folder-shows"]);
  assert.ok(made.permissions.some((p) => p.email === "ingrid@example.com"));
  const show = (await db.get("shows", id))!;
  assert.equal(show.driveFolderId, f.id);
  assert.equal(show.driveFolderName, "2027-01-16 Hi-Dive");
  assert.equal((await cmd("shows.folder", { id })).id, f.id); // the same one again
  await code(cmd("shows.folder", { id: "nope" }), "not_found");
});

test("posters: attach by Drive id (members too), skipped when already on the show, removed without touching Drive", async () => {
  const { id } = await create();
  await cmd("google.setShowsFolder", { folder: "fake-folder-shows" });
  const folder = await cmd("shows.folder", { id });
  const drive = driveClient({ artistId: TEST_ARTIST });
  const up = await drive.upload({ name: "Hi-Dive poster.png", mimeType: "image/png", parentId: folder.id, data: new Blob(["png"]) });
  const a = await cmd("shows.posters.attach", { showId: id, files: [{ driveFileId: up.id }] }, mctx);
  assert.equal(a.ids.length, 1);
  const poster = (await db.get("files", a.ids[0]))!;
  assert.equal(poster.kind, "poster");
  assert.equal(poster.showId, id);
  assert.equal(poster.songId, undefined);
  assert.equal(poster.title, "Hi-Dive poster.png");
  assert.equal(poster.inBandFolder, true); // the show folder is under the Shows folder
  const again = await cmd("shows.posters.attach", { showId: id, files: [{ driveFileId: up.id }, { driveFileId: "fake-release-cover", title: "Cover" }] });
  assert.equal(again.skipped, 1);
  assert.equal(again.ids.length, 1);
  await code(cmd("shows.posters.attach", { showId: id, files: [{ driveFileId: "nope" }] }), "not_found");
  await code(cmd("shows.posters.attach", { showId: "nope", files: [{ driveFileId: up.id }] }), "not_found");
  await cmd("shows.posters.remove", { id: a.ids[0] }, mctx);
  assert.ok((await db.get("files", a.ids[0]))!.deletedAt);
  assert.equal((await drive.get(up.id)).name, "Hi-Dive poster.png");
  await code(cmd("shows.posters.remove", { id: again.ids[0] + "x" }), "not_found");
  // a song's file isn't a poster
  const song = await db.create(ctx, "files", { kind: "demo", title: "d", url: "https://x.test/d", provider: "web", checkedAt: new Date() });
  await code(cmd("shows.posters.remove", { id: song.id }), "not_found");
});
