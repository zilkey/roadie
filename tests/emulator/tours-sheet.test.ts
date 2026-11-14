/** The Sheet tab (#52): the rows (admin and band), the CSV, and tours.sheet's one linked Google Sheet in the fake Drive. */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { BAND_FOLDER_ID } from "../../fakes/fake-drive/server";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { isEligible } from "@/server/assistant/policy";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

// ---------- tours.sheet ----------

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  for (const [name, env] of [["fake-ors", "ORS_BASE_URL"], ["fake-drive", "DRIVE_BASE_URL"], ["fake-calendar", "CALENDAR_BASE_URL"]] as const) {
    if (s.running[name]) process.env[env] = s.running[name].url;
  }
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const contentOf = async (id: string) => (await fetch(`${process.env.DRIVE_BASE_URL}/files/${id}/content`)).text();

beforeEach(async () => {
  await resetEmulators();
  await fetch(process.env.DRIVE_BASE_URL + "/__reset", { method: "POST" });
  const a = await makeUser("rudy@example.com", "admin", { name: "Rudy Pike" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST, now: new Date("2026-11-06T18:00:00Z") };
  await db.create(ctx, "artists", { slug: "band", name: "Band", driveFolderId: BAND_FOLDER_ID, links: {}, configurations: [] }, { id: TEST_ARTIST });
});

test("tours.sheet makes one Google Sheet in the band folder, the band version, then rewrites the same one", async () => {
  const duo = (await cmd("projects.create", { kind: "duo", name: "Duo", isDefault: true })).id;
  const velour = (await cmd("venues.create", venue("Velour", "Provo", { address: { city: "Provo", state: "UT" }, region: "out" }))).id;
  const t = (await cmd("tours.create", { name: "Mountain West", projectId: duo, startDate: "2026-11-05", endDate: "2026-11-07" })).id;
  await cmd("tours.entries.add", { tourId: t, kind: "stay", date: "2026-11-05", name: "Airbnb" });
  await cmd("tours.addPitch", { tourId: t, venueId: velour, dates: ["2026-11-06"] });

  const first = await cmd("tours.sheet", { id: t });
  assert.equal(first.made, true);
  const linked = (await db.get("tours", t))!.sheet;
  assert.equal(linked.updatedBy, "Rudy");
  assert.equal(linked.updatedAt, "2026-11-06T18:00:00.000Z");
  const file = await (await fetch(`${process.env.DRIVE_BASE_URL}/files/${linked.driveFileId}`)).json();
  assert.deepEqual([file.name, file.mimeType, file.parents], ["Mountain West", "application/vnd.google-apps.spreadsheet", [BAND_FOLDER_ID]]);
  const csv = await contentOf(linked.driveFileId);
  assert.ok(csv.startsWith("Date,Day,Town,"));
  assert.ok(csv.includes("Airbnb"));
  assert.ok(!csv.includes("Velour") && !csv.includes("Open"), "never the options");

  await cmd("tours.entries.add", { tourId: t, kind: "note", date: "2026-11-06", text: "Laundry" });
  const second = await cmd("tours.sheet", { id: t });
  assert.equal(second.made, false);
  assert.equal((await db.get("tours", t))!.sheet.driveFileId, linked.driveFileId, "the same sheet");
  assert.ok((await contentOf(linked.driveFileId)).includes("Laundry"));
  const sheets = await (await fetch(`${process.env.DRIVE_BASE_URL}/files?mimeType=application/vnd.google-apps.spreadsheet&parent=${BAND_FOLDER_ID}`)).json();
  assert.equal(sheets.length, 1, "a second copy never makes a second file");
});

test("tours.sheet: admins only, needs the band folder, and Roadie never gets it", async () => {
  assert.deepEqual(registry["tours.sheet"].roles, ["admin"]);
  assert.equal(isEligible("tours.sheet", "admin"), false);
  await db.update(ctx, "artists", TEST_ARTIST, { driveFolderId: "" });
  const duo = (await cmd("projects.create", { kind: "duo", name: "Duo", isDefault: true })).id;
  const t = (await cmd("tours.create", { name: "Mountain West", projectId: duo, startDate: "2026-11-05", endDate: "2026-11-06" })).id;
  await assert.rejects(cmd("tours.sheet", { id: t }), (err: any) => err.code === "no_band_folder"); // eslint-disable-line @typescript-eslint/no-explicit-any
});
