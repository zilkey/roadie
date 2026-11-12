import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { fakeDrive, SOCIALS_FOLDER_ID } from "../../fakes/fake-drive/server";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { driveClient, IntegrationError, type DriveService } from "@/server/integrations";
import { listQuery } from "@/server/integrations/drive";
import { findOrMakeFolder } from "@/server/driveFolders";
import { isEmpty, uniqueName, inboxFolders, moveInto, moveBack, listAll } from "@/server/postFolder";
import { resetEmulators, makeUser, makeArtist, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let URL_: string;
let drive: DriveService;
let ctx: Ctx;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await fakeDrive.start({ dataDir: dir, port: 0 });
  stop = s.close;
  URL_ = s.url;
  process.env.DRIVE_BASE_URL = URL_;
  drive = driveClient({ artistId: TEST_ARTIST });
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const scenario = (body: Record<string, unknown>) => fetch(`${URL_}/__scenario`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const PHONE = "fake-folder-socials-phone", MONTH = "fake-folder-socials-2026-10";
const ids = (fs_: { id: string }[]) => fs_.map((f) => f.id).sort();

beforeEach(async () => {
  await resetEmulators();
  await fetch(`${URL_}/__reset`, { method: "POST" });
  const rudy = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  ctx = { uid: rudy.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  await db.create(ctx, "artists", { slug: "band", name: "Band", driveFolderId: "fake-band-folder", postsFolderId: SOCIALS_FOLDER_ID, links: {}, configurations: [] }, { id: TEST_ARTIST });
});

test("list: one parent or several, by kind, newest added first, paged; trashed files are left out", async () => {
  const images = await drive.list({ parents: [PHONE], kind: "images" });
  assert.equal(images.files.length, 6, "the phone folder's 6 photos, the octet-stream HEIC by its name");
  assert.ok(images.files.some((f) => f.name === "IMG_2202.HEIC" && f.mimeType === "application/octet-stream"));
  const rotated = images.files.find((f) => f.id === "fake-social-rotated")!;
  assert.deepEqual(rotated.image, { width: 1200, height: 900, rotation: 1, time: "2026:10:10 21:15:00" });
  assert.ok(rotated.thumbnailLink && rotated.modifiedTime && rotated.size);

  const root = await drive.list({ parents: [SOCIALS_FOLDER_ID], kind: "all" });
  assert.deepEqual(ids(root.files), ["fake-folder-socials-2026-10", "fake-folder-socials-phone", "fake-social-loose-1", "fake-social-loose-2", "fake-social-loose-3", "fake-social-pdf"]);
  assert.deepEqual(ids((await drive.list({ parents: [SOCIALS_FOLDER_ID], kind: "folders" })).files), [MONTH, PHONE]);
  assert.deepEqual(ids((await drive.list({ parents: [SOCIALS_FOLDER_ID], kind: "images" })).files), ["fake-social-loose-1", "fake-social-loose-2", "fake-social-loose-3"], "not the PDF or the folders");

  const newest = await drive.list({ parents: [PHONE, SOCIALS_FOLDER_ID, MONTH], kind: "images", orderBy: "createdTime desc" });
  assert.equal(newest.files.length, 10);
  assert.deepEqual(newest.files.map((f) => f.createdAt), newest.files.map((f) => f.createdAt).slice().sort().reverse(), "newest added first, across parents");

  const p1 = await drive.list({ parents: [PHONE], kind: "images", orderBy: "createdTime desc", pageSize: 4 });
  assert.equal(p1.files.length, 4);
  assert.ok(p1.nextPageToken);
  const p2 = await drive.list({ parents: [PHONE], kind: "images", orderBy: "createdTime desc", pageSize: 4, pageToken: p1.nextPageToken });
  assert.equal(p2.files.length, 2);
  assert.equal(p2.nextPageToken, undefined);
  assert.deepEqual(ids([...p1.files, ...p2.files]), ids(images.files));
  assert.deepEqual(ids(await listAll(drive, [PHONE], "images")), ids(images.files));

  await drive.trash("fake-social-loose-1");
  assert.ok(!(await drive.list({ parents: [SOCIALS_FOLDER_ID], kind: "images" })).files.some((f) => f.id === "fake-social-loose-1"));
  assert.equal((await drive.get("fake-social-loose-1")).trashed, true, "get still answers, flagged trashed");
  assert.ok(!(await drive.search({ parent: SOCIALS_FOLDER_ID })).some((f) => f.id === "fake-social-loose-1"), "search leaves it out too");
});

test("the real list's query: any of the parents, not trashed, and the kind", () => {
  assert.equal(listQuery(["a", "b"], "all"), "('a' in parents or 'b' in parents) and trashed = false");
  assert.equal(listQuery(["a"], "images"), "('a' in parents) and trashed = false and (mimeType contains 'image/' or name contains '.heic' or name contains '.HEIC' or name contains '.heif')");
  assert.equal(listQuery(["a"], "folders"), "('a' in parents) and trashed = false and mimeType = 'application/vnd.google-apps.folder'");
  assert.equal(listQuery(["it's"], "all"), "('it\\'s' in parents) and trashed = false", "an id is quoted as a literal");
});

test("update: renames and moves, bumping modifiedTime; rename stays a wrapper over it", async () => {
  const before_ = await drive.get("fake-social-loose-1");
  const moved = await drive.update("fake-social-loose-1", { addParents: [PHONE], removeParents: [SOCIALS_FOLDER_ID] });
  assert.deepEqual(moved.parents, [PHONE]);
  assert.ok(moved.modifiedTime! > before_.modifiedTime!, "modifiedTime moves on");
  const renamed = await drive.update("fake-social-loose-1", { name: "Renamed.JPG" });
  assert.equal(renamed.name, "Renamed.JPG");
  assert.deepEqual(renamed.parents, [PHONE]);
  assert.equal((await drive.rename("fake-social-loose-1", "Again.JPG")).name, "Again.JPG");
  const made = await drive.createFolder("New", SOCIALS_FOLDER_ID);
  assert.ok(made.modifiedTime, "a new file has a modifiedTime");
  await assert.rejects(drive.update("fake-social-loose-1", { addParents: ["fake-social-pdf"], removeParents: [PHONE] }), (e: IntegrationError) => e.status === 400, "only into a folder");
});

test("failMove fails the nth move from now with a 500; failRename fails renames", async () => {
  await scenario({ failMove: 2 });
  await moveInto(drive, "fake-social-loose-1", PHONE, SOCIALS_FOLDER_ID);
  await assert.rejects(moveInto(drive, "fake-social-loose-2", PHONE, SOCIALS_FOLDER_ID), (e: IntegrationError) => e.status === 500);
  assert.deepEqual((await drive.get("fake-social-loose-2")).parents, [SOCIALS_FOLDER_ID], "the failed move changed nothing");
  await moveInto(drive, "fake-social-loose-3", PHONE, SOCIALS_FOLDER_ID);
  await drive.rename("fake-social-loose-3", "Fine.png");
  await scenario({ failRename: true });
  await assert.rejects(drive.rename("fake-social-loose-3", "Nope.png"), (e: IntegrationError) => e.status === 500);
  assert.equal((await drive.get("fake-social-loose-3")).name, "Fine.png");
});

test("isEmpty: a folder with nothing in it; a PDF makes it not empty; a trashed file doesn't count", async () => {
  const { folder } = await findOrMakeFolder(drive, SOCIALS_FOLDER_ID, "Posts");
  const post = await drive.createFolder("DRAFT - Hi-Dive", folder.id);
  assert.equal(await isEmpty(drive, post.id), true);
  await moveInto(drive, "fake-social-pdf", post.id, SOCIALS_FOLDER_ID);
  assert.equal(await isEmpty(drive, post.id), false, "the PDF counts");
  await moveInto(drive, "fake-social-pdf", SOCIALS_FOLDER_ID, post.id);
  assert.equal(await isEmpty(drive, post.id), true);
  await moveInto(drive, "fake-social-loose-1", post.id, SOCIALS_FOLDER_ID);
  await drive.trash("fake-social-loose-1");
  assert.equal(await isEmpty(drive, post.id), true, "a trashed file isn't in it");
  await drive.trash(post.id);
  assert.equal((await drive.get(post.id)).trashed, true);
  assert.ok(!(await drive.list({ parents: [folder.id], kind: "folders" })).files.length);
});

test("uniqueName: the name, then (2), (3)… among the folders in the parent; a folder's own name doesn't count against it", async () => {
  const { folder: posts } = await findOrMakeFolder(drive, SOCIALS_FOLDER_ID, "Posts");
  assert.equal(await uniqueName(drive, posts.id, "DRAFT - Hi-Dive"), "DRAFT - Hi-Dive");
  const a = await drive.createFolder("DRAFT - Hi-Dive", posts.id);
  assert.equal(await uniqueName(drive, posts.id, "DRAFT - Hi-Dive"), "DRAFT - Hi-Dive (2)");
  await drive.createFolder("DRAFT - Hi-Dive (2)", posts.id);
  assert.equal(await uniqueName(drive, posts.id, "DRAFT - Hi-Dive"), "DRAFT - Hi-Dive (3)");
  assert.equal(await uniqueName(drive, posts.id, "DRAFT - Hi-Dive", a.id), "DRAFT - Hi-Dive", "renaming a folder to its own name");
  assert.equal(await uniqueName(drive, posts.id, "2026-11-03 - Thanks, Denver"), "2026-11-03 - Thanks, Denver");
  // Only folders in that parent count.
  await drive.createFolder("Elsewhere", SOCIALS_FOLDER_ID);
  assert.equal(await uniqueName(drive, posts.id, "Elsewhere"), "Elsewhere");
});

test("canMoveIn: a folder in the Shared Drive the band account can move in and out of; not with noMove", async () => {
  assert.equal(await drive.canMoveIn(SOCIALS_FOLDER_ID), true);
  await scenario({ noMove: true });
  assert.equal(await drive.canMoveIn(SOCIALS_FOLDER_ID), false);
});

test("thumbnail: an upright JPEG, its long edge the size asked; 404 with noThumbnail and for a PDF", async () => {
  const meta = async (id: string, s: number) => sharp(Buffer.from(await (await drive.thumbnail(id, s)).arrayBuffer())).metadata();
  const r = await meta("fake-social-rotated", 400);
  assert.deepEqual([r.format, r.width, r.height], ["jpeg", 300, 400], "stored 1200×900 with rotation 1: upright 900×1200");
  const l = await meta("fake-social-late", 1080);
  assert.deepEqual([l.width, l.height], [1080, 675]);
  const h = await meta("fake-social-heic-2", 2048);
  assert.deepEqual([h.format, h.width, h.height], ["jpeg", 1536, 2048], "a HEIC (octet-stream) previews as a JPEG");
  await scenario({ noThumbnail: ["fake-social-heic-2"] });
  await assert.rejects(drive.thumbnail("fake-social-heic-2", 400), (e: IntegrationError) => e instanceof IntegrationError && e.status === 404);
  await assert.rejects(drive.thumbnail("fake-social-pdf", 400), (e: IntegrationError) => e.status === 404);
});

test("content: the seeded photos serve their fixture bytes (the rotated one keeps EXIF orientation 6)", async () => {
  const m = await sharp(Buffer.from(await (await drive.download("fake-social-rotated")).arrayBuffer())).metadata();
  assert.deepEqual([m.width, m.height, m.orientation], [1200, 900, 6]);
  const l = await sharp(Buffer.from(await (await drive.download("fake-social-late")).arrayBuffer())).metadata();
  assert.deepEqual([l.width, l.height], [1600, 1000]);
});

test("inboxFolders: every folder under Socials, nested, except Posts/ (by name before Set up, by id after)", async () => {
  const nested = await drive.createFolder("Encore", PHONE);
  const deeper = await drive.createFolder("B-roll", nested.id);
  const { folder: posts } = await findOrMakeFolder(drive, SOCIALS_FOLDER_ID, "Posts");
  const draft = await drive.createFolder("DRAFT - Hi-Dive", posts.id);
  const got = await inboxFolders(drive, TEST_ARTIST);
  assert.deepEqual(got.map((f) => f.id).sort(), [MONTH, PHONE, nested.id, deeper.id].sort());
  assert.deepEqual(got.find((f) => f.id === deeper.id), { id: deeper.id, name: "B-roll", parentId: nested.id });
  assert.equal(got.find((f) => f.id === PHONE)!.parentId, SOCIALS_FOLDER_ID);
  assert.ok(!got.some((f) => f.id === draft.id), "nothing under Posts/");

  // Once Set up saved Posts/ under another name, it's skipped by id; a folder called Posts deeper down is just a folder.
  await drive.rename(posts.id, "Posts (Roadie)");
  await db.update(ctx, "artists", TEST_ARTIST, { postFoldersId: posts.id });
  const deepPosts = await drive.createFolder("Posts", PHONE);
  const again = (await inboxFolders(drive, TEST_ARTIST)).map((f) => f.id);
  assert.ok(!again.includes(posts.id) && !again.includes(draft.id));
  assert.ok(again.includes(deepPosts.id));

  await makeArtist("Other Band", "other-band", "no-socials");
  await assert.rejects(inboxFolders(drive, "no-socials"), (e: { code?: string }) => e.code === "no_posts_folder", "no Socials folder chosen");
});

test("moveInto and moveBack: back to the folder it came from, or the Socials root when that folder is gone or trashed", async () => {
  const { folder: posts } = await findOrMakeFolder(drive, SOCIALS_FOLDER_ID, "Posts");
  const post = await drive.createFolder("DRAFT - x", posts.id);
  for (const id of ["fake-social-late", "fake-social-phone-5", "fake-social-loose-1"]) {
    const from = (await drive.get(id)).parents[0];
    await moveInto(drive, id, post.id, from);
  }
  assert.equal((await drive.list({ parents: [post.id], kind: "images" })).files.length, 3);
  const at = { socialsId: SOCIALS_FOLDER_ID, postFolderId: post.id };
  assert.equal(await moveBack(drive, at, { driveFileId: "fake-social-late", from: { folderId: PHONE } }), PHONE);
  assert.deepEqual((await drive.get("fake-social-late")).parents, [PHONE]);
  await drive.trash(PHONE);
  assert.equal(await moveBack(drive, at, { driveFileId: "fake-social-phone-5", from: { folderId: PHONE } }), SOCIALS_FOLDER_ID, "its folder is trashed");
  assert.equal(await moveBack(drive, at, { driveFileId: "fake-social-loose-1", from: { folderId: "gone-folder" } }), SOCIALS_FOLDER_ID, "its folder is gone");
  assert.deepEqual((await drive.get("fake-social-loose-1")).parents, [SOCIALS_FOLDER_ID]);
  assert.equal(await isEmpty(drive, post.id), true);
});

test("findOrMakeFolder: finds a folder by name or makes one, sharing only a folder it made, as reader unless asked", async () => {
  const made = await findOrMakeFolder(drive, SOCIALS_FOLDER_ID, "Posts", { emails: ["nora@example.com"], role: "writer" });
  assert.equal(made.made, true);
  assert.ok((await drive.get(made.folder.id)).permissions.some((p) => p.email === "nora@example.com" && p.role === "writer"));
  const found = await findOrMakeFolder(drive, SOCIALS_FOLDER_ID, "Posts", { emails: ["iris@example.com"] });
  assert.deepEqual([found.made, found.folder.id], [false, made.folder.id]);
  assert.ok(!(await drive.get(made.folder.id)).permissions.some((p) => p.email === "iris@example.com"), "a found folder keeps its sharing");
  const plain = await findOrMakeFolder(drive, SOCIALS_FOLDER_ID, "Reader", { emails: ["hugo@example.com"] });
  assert.ok((await drive.get(plain.folder.id)).permissions.some((p) => p.email === "hugo@example.com" && p.role === "reader"));
  const none = await findOrMakeFolder(drive, SOCIALS_FOLDER_ID, "Unshared");
  assert.deepEqual((await drive.get(none.folder.id)).permissions.map((p) => p.role), ["owner"]);
});
