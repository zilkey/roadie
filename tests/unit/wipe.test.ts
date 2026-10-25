import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/server/db";
import { adminAuth, firestore } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { dumpAll } from "@/server/backup";
import { localStamp, wipe } from "../../scripts/wipe";
import { makeUser, resetEmulators, venue } from "./helpers";

beforeEach(resetEmulators);

/** A venue with history, a pitch with sub-collections, a draft, and two Auth users with their users docs. */
async function seedSomething() {
  const ctx = importCtx("tester", "wipe-run");
  const v = await db.create(ctx, "venues", venue("Bluebird", "Denver", { capacity: 500 }));
  await db.update(ctx, "venues", v.id, { website: "https://bluebird.example" });
  const p = await db.create(ctx, "pitches", { target: { kind: "venue", id: v.id, name: "Bluebird" }, status: "toPitch", artistId: "a", personnel: [], showIds: [] });
  await firestore().doc(`pitches/${p.id}/activity/one`).set({ id: "one", type: "note", text: "called" });
  await firestore().doc("unsubmittedDrafts/u__venues").set({ uid: "u", path: "venues", data: {} });
  await makeUser("jeff@zilkey.com", "admin");
  await makeUser("member@example.com", "member");
  return { venueId: v.id, pitchId: p.id };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "wipe-"));

test("a dry run deletes nothing, writes no backup, and reports the seeded counts", async () => {
  await seedSomething();
  const before = await dumpAll(firestore());
  const out = tmp();
  try {
    const r = await wipe(firestore(), { dryRun: true, outRoot: out, date: "2026-10-24" });
    assert.equal(r.dryRun, true);
    assert.equal(r.backupDir, null, "a dry run deletes nothing, so it backs up nothing");
    assert.deepEqual(fs.readdirSync(out), [], "no backup folder was written");

    // Counts match what is actually there, sub-collection docs counted under their parent.
    assert.equal(r.collections.venues, before.venues.length);
    assert.equal(r.collections.pitches, before.pitches.length);
    assert.equal(r.collections.users, before.users.length, "2 users plus their history entries");
    assert.equal(r.collections.unsubmittedDrafts, 1, "cleared although it is not in the backup");
    assert.equal(r.documents, Object.values(r.collections).reduce((n, c) => n + c, 0));
    assert.equal(r.authUsers, 2);

    // Nothing moved.
    assert.deepEqual(await dumpAll(firestore()), before);
    assert.equal((await adminAuth().listUsers(10)).users.length, 2);
    assert.ok(await db.get("venues", (await db.list("venues"))[0].id));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test("after a wipe every collection is empty and no Auth users remain", async () => {
  const { pitchId } = await seedSomething();
  const out = tmp();
  try {
    const r = await wipe(firestore(), { outRoot: out, date: "2026-10-24" });
    assert.equal(r.dryRun, false);
    assert.equal(r.authUsers, 2);

    assert.deepEqual(await dumpAll(firestore()), {}, "no documents left, sub-collections included");
    for (const col of await firestore().listCollections()) {
      assert.ok((await col.limit(1).get()).empty, `${col.id} still has documents`);
    }
    assert.equal((await firestore().doc(`pitches/${pitchId}/activity/one`).get()).exists, false, "sub-collection documents go too");
    assert.equal((await firestore().doc("unsubmittedDrafts/u__venues").get()).exists, false, "drafts go, so no stale create form reopens");
    assert.equal((await adminAuth().listUsers(10)).users.length, 0, "jeff@zilkey.com included: the seed puts it back");
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test("the backup runs before the first delete, and holds the documents that were there", async () => {
  await seedSomething();
  const before = await dumpAll(firestore());
  const out = tmp();
  try {
    const r = await wipe(firestore(), { outRoot: out, date: "2026-10-24T21-07-03" });
    assert.equal(r.backupDir, path.join(out, "2026-10-24T21-07-03"));

    // The backup is non-empty and its counts are the counts from before the wipe: it can only have been taken
    // while the documents still existed.
    const manifest = JSON.parse(fs.readFileSync(path.join(r.backupDir!, "_manifest.json"), "utf8")) as { counts: Record<string, number> };
    assert.equal(manifest.counts.venues, before.venues.length);
    assert.equal(manifest.counts.pitches, before.pitches.length);
    assert.ok(before.venues.length > 0 && before.pitches.length > 0, "there was something to lose");
    const saved = JSON.parse(fs.readFileSync(path.join(r.backupDir!, "venues.json"), "utf8")) as unknown[];
    assert.deepEqual(saved, before.venues, "the backup holds the pre-wipe venues, history included");
    assert.ok(fs.existsSync(path.join(r.backupDir!, "users.json")));

    // ...and the database really is empty now, so the backup is the only copy.
    assert.deepEqual(await dumpAll(firestore()), {});
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test("the backup folder is stamped in local time, to the second", async () => {
  // 21:07 local on Oct 24 is already Oct 25 UTC: the folder must say the 24th, the day it is where the wipe is run.
  const evening = new Date(2026, 9, 24, 21, 7, 3);
  assert.equal(localStamp(evening), "2026-10-24T21-07-03");
  assert.equal(evening.toISOString().slice(0, 10), "2026-10-25", "a UTC date would have filed it under tomorrow");
  // Two wipes in one sitting get two folders, so the second cannot overwrite the first one's backup.
  assert.notEqual(localStamp(new Date(2026, 9, 24, 21, 7, 3)), localStamp(new Date(2026, 9, 24, 21, 7, 4)));
  assert.match(localStamp(), /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  assert.ok(!localStamp().includes(":"), "no colons: they are awkward in paths");
});

test("a wipe with no date given writes a stamped folder and uses it", async () => {
  await seedSomething();
  const out = tmp();
  try {
    const r = await wipe(firestore(), { outRoot: out });
    assert.match(path.basename(r.backupDir!), /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    assert.deepEqual(fs.readdirSync(out), [path.basename(r.backupDir!)]);
    assert.ok(fs.existsSync(path.join(r.backupDir!, "_manifest.json")));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test("a backup that fails stops the run with nothing deleted", async () => {
  await seedSomething();
  const before = await dumpAll(firestore());
  // An unwritable out root makes backup() throw before the first delete.
  const out = path.join(tmp(), "file-not-a-dir");
  fs.writeFileSync(out, "");
  await assert.rejects(() => wipe(firestore(), { outRoot: out, date: "2026-10-24" }));
  assert.deepEqual(await dumpAll(firestore()), before, "nothing was deleted");
  assert.equal((await adminAuth().listUsers(10)).users.length, 2);
});

test("the CLI refuses a real-Firestore wipe without --yes or with a mismatched --project, and deletes nothing", async () => {
  await seedSomething();
  const before = await dumpAll(firestore());
  const script = path.join(process.cwd(), "scripts/wipe.ts");
  // No emulator hosts in the environment, so the script treats the target as real Firestore. The project id is a
  // made-up one: every assertion below is on a guard that throws before firestore() is called, so nothing is
  // contacted -- and naming a real project here is exactly what this script is built to make hard.
  const PROJECT = "not-a-real-project-xyz";
  const { FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, GOOGLE_APPLICATION_CREDENTIALS, ...bare } = process.env;
  const { spawnSync } = await import("node:child_process");
  // GCLOUD_PROJECT is set for the test suite, so it has to be deleted rather than spread over with undefined
  // (a spread keeps the key, and the script would see the demo project instead of no target at all).
  const run = (args: string[], env: Record<string, string> = {}) => {
    const e = { ...bare, ...env } as NodeJS.ProcessEnv;
    if (!("GCLOUD_PROJECT" in env)) delete e.GCLOUD_PROJECT;
    const r = spawnSync("npx", ["tsx", script, ...args], { env: e, encoding: "utf8", timeout: 60_000 });
    return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  };

  // No target at all: it must not guess.
  const noTarget = run(["--yes"]);
  assert.notEqual(noTarget.code, 0);
  assert.match(noTarget.out, /Refusing to guess/, noTarget.out);

  // --yes but no --project: refused, and the target was named on the first line.
  const noProject = run(["--yes"], { GCLOUD_PROJECT: PROJECT });
  assert.notEqual(noProject.code, 0);
  assert.match(noProject.out, new RegExp(`Target: ${PROJECT} \\(REAL Firestore\\)`), noProject.out);
  assert.match(noProject.out, new RegExp(`needs --project=${PROJECT}`), noProject.out);

  // A --project that is close but not exact: refused.
  const mismatch = run(["--yes", `--project=${PROJECT.slice(0, -1)}`], { GCLOUD_PROJECT: PROJECT });
  assert.notEqual(mismatch.code, 0);
  assert.match(mismatch.out, /does not match GCLOUD_PROJECT/, mismatch.out);
  assert.match(mismatch.out, /Nothing deleted/, mismatch.out);

  // The emulator data is untouched: none of those runs deleted anything anywhere.
  assert.deepEqual(await dumpAll(firestore()), before);
  assert.equal((await adminAuth().listUsers(10)).users.length, 2);
});

test("no flag at all is a dry run: a bare run can never delete", async () => {
  await seedSomething();
  const before = await dumpAll(firestore());
  const script = path.join(process.cwd(), "scripts/wipe.ts");
  const { spawnSync } = await import("node:child_process");
  // Emulator host kept, so this run really does reach a database -- and still must not delete.
  const r = spawnSync("npx", ["tsx", script], { env: process.env, encoding: "utf8", timeout: 60_000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  assert.equal(r.status, 0, out);
  assert.match(out, /^Target: demo-band-tracker \(emulator at /m, out);
  assert.match(out, /Would delete/, out);
  assert.match(out, /dry run, nothing deleted/, out);
  assert.deepEqual(await dumpAll(firestore()), before, "a bare run deletes nothing");
  assert.equal((await adminAuth().listUsers(10)).users.length, 2);
});
