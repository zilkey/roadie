import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { execute } from "@/server/commands/dispatch";
import { artistCtx, importCtx, type Ctx } from "@/server/ctx";
import { db } from "@/server/db";
import { driveClient } from "@/server/integrations";
import { bandmates } from "@/server/music";
import { resetEmulators, makeUser, SYS } from "./helpers";

// Tenancy plan D3 "Google": Drive work for one artist never reaches another's people or files, even when one Google account is
// the band account of both. Against the fake Drive.

let stop: () => Promise<void>;
let dir: string;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.DRIVE_BASE_URL = s.running["fake-drive"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

let a: Ctx, b: Ctx;
beforeEach(async () => {
  await resetEmulators();
  await fetch(process.env.DRIVE_BASE_URL + "/__reset", { method: "POST" });
  for (const [id, folder] of [["A", "fake-band-folder"], ["B", "fake-other-band"]]) {
    await db.create(importCtx(id), "artists", { timeZone: "America/Denver", name: `Band ${id}`, slug: `band-${id.toLowerCase()}`, driveFolderId: folder, chartsFolderId: id === "A" ? "fake-folder-charts" : "", links: {}, configurations: [] }, { id });
  }
  const ua = await makeUser("rudy@example.com", "admin", { artistId: "A" });
  const ub = await makeUser("zed@b.example", "admin", { artistId: "B" });
  a = artistCtx({ uid: ua.uid, role: "admin", artistId: "A", via: "app" });
  b = artistCtx({ uid: ub.uid, role: "admin", artistId: "B", via: "app" });
  for (const n of ["nora", "rudy", "hugo"]) await db.create(a, "musicians", { name: n, instruments: ["x"], active: true, email: `${n}@example.com` });
  await db.create(b, "musicians", { name: "Zed", instruments: ["x"], active: true, email: "zed@b.example" });
});

const newFile = async (name: string, ownerEmail: string, parents: string[]) =>
  (await (await fetch(process.env.DRIVE_BASE_URL + "/files", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, ownerEmail, parents }) })).json()) as { id: string };

test("A's bandmates (who Drive shares go to) are A's musicians only", async () => {
  assert.deepEqual((await bandmates(a)).map((m) => m.email).sort(), ["hugo@example.com", "nora@example.com", "rudy@example.com"]);
  // A share from A never reaches B's people.
  const { id: songId } = (await execute(a, "songs.create", { title: "Sundial", status: "active", files: [{ driveFileId: "fake-demo-2" }] })).result as { id: string };
  const [file] = await db.list(SYS, "files", (q) => q.where("songId", "==", songId));
  await execute(a, "files.shareWithBand", { ids: [file.id] });
  const perms = await driveClient({ artistId: "A" }).permissions("fake-demo-2");
  assert.ok(!perms.some((p) => p.email === "zed@b.example"));
});

test("a Drive id that isn't in the artist's folder and isn't a bandmate's is refused", async () => {
  const stranger = await newFile("B's private chart.docx", "zed@b.example", ["fake-other-band"]);
  await assert.rejects(execute(a, "songs.create", { title: "Theirs", status: "active", files: [{ driveFileId: stranger.id }] }), { code: "outside_band_folder" });
  await assert.rejects(execute(a, "drive.fix", { driveFileIds: [stranger.id], fix: "share" }), { code: "drive_error" });
  await assert.rejects(execute(a, "drive.fix", { driveFileIds: [stranger.id], fix: "copy" }), { code: "drive_error" });
  assert.deepEqual((await driveClient({ artistId: "A" }).permissions(stranger.id)).map((p) => p.email), ["zed@b.example"]);
  // In B, where it belongs, it attaches.
  const r = (await execute(b, "songs.create", { title: "Mine", status: "active", files: [{ driveFileId: stranger.id }] })).result as { fileIds: string[] };
  assert.equal(r.fileIds.length, 1);
  // A bandmate's own file outside the folder is still fine (it's about to be copied in).
  const own = await newFile("Nora's lyrics.docx", "nora@example.com", ["root-nora"]);
  assert.equal(((await execute(a, "songs.create", { title: "Hers", status: "active", files: [{ driveFileId: own.id }] })).result as { fileIds: string[] }).fileIds.length, 1);
});
