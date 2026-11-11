import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { registry } from "@/server/commands/registry";
import { undoRun } from "@/server/undo";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";

let ctx: Ctx;
let bliss: string, blissL: string, wild: string, theWild: string, other: string;

beforeEach(async () => {
  await resetEmulators();
  const a = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  ctx = { uid: a.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  const set = importCtx("setup", "setup-run");
  const mk = async (s: Record<string, unknown>) => (await db.create(set, "songs", { fields: [], ...s })).id;
  bliss = await mk({ title: "The Bliss", status: "active", key: "Em", bpm: 96, lengthSec: 200, writers: "Nora", notes: "Kept note", fields: [{ fieldId: "capo", value: "2" }] });
  blissL = await mk({ title: "The Bliss", status: "learning", key: "G", lengthSec: 210, notes: "Learning note", lyricsDoc: { driveFileId: "ly1", url: "https://example.com/ly1" }, fields: [{ fieldId: "capo", value: "4" }, { fieldId: "plays", value: "Felix" }] });
  wild = await mk({ title: "The Wild Edge", status: "active" });
  theWild = await mk({ title: "Wild Edge", status: "learning", key: "A", bpm: 120, lengthSec: 180, writers: "Felix" });
  other = await mk({ title: "Other Song", status: "active", key: "C", lengthSec: 100 });
});

const merge = async (input: unknown, c: Ctx = ctx) => {
  const x = registry["songs.merge"];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const code = (p: Promise<unknown>, c: string) => assert.rejects(p, (e: any) => e.code === c); // eslint-disable-line @typescript-eslint/no-explicit-any
const file = (songId: string | undefined, extra: Record<string, unknown>) => db.create(importCtx("setup", "setup-run"), "files", { kind: "chart", title: "f", url: "https://example.com/x", checkedAt: new Date(), songId, ...extra }).then((d) => d.id);

/** Every document of the collections a merge touches, minus the server stamps that change with each write. */
async function snapshot() {
  const out: Record<string, unknown> = {};
  const releases = await db.list("releases", undefined, { includeDeleted: true });
  const paths = ["songs", "files", "setlists", "setlistTemplates", "rehearsals", "releases", ...releases.map((r) => `releases/${r.id}/tracks`)];
  for (const p of paths) {
    for (const d of await db.list(p, undefined, { includeDeleted: true })) {
      const { updatedAt: _u, updatedBy: _b, rev: _r, runId: _i, via: _v, ...rest } = d;
      out[`${p}/${d.id}`] = JSON.parse(JSON.stringify(rest));
    }
  }
  return out;
}

test("blank fields are filled from the others; the kept song keeps its own; notes join; custom fields combine with the kept value winning", async () => {
  const r = await merge({ keepId: bliss, mergeIds: [blissL] });
  assert.deepEqual(r.merged, [blissL]);
  const k = (await db.get("songs", bliss))!;
  assert.equal(k.title, "The Bliss");
  assert.equal(k.status, "active");
  assert.equal(k.key, "Em");
  assert.equal(k.bpm, 96);
  assert.equal(k.lengthSec, 200);
  assert.equal(k.writers, "Nora");
  assert.deepEqual(k.lyricsDoc, { driveFileId: "ly1", url: "https://example.com/ly1" }, "the lyrics doc comes from the other");
  assert.equal(k.notes, "Kept note\n\nLearning note");
  assert.deepEqual(k.fields, [{ fieldId: "capo", value: "2" }, { fieldId: "plays", value: "Felix" }]);
  assert.deepEqual(k.mergedFrom, [{ id: blissL, title: "The Bliss", status: "learning" }]);

  // A blank on the kept song is filled; the first other song with a value wins.
  await merge({ keepId: wild, mergeIds: [theWild] });
  const w = (await db.get("songs", wild))!;
  assert.equal(w.title, "The Wild Edge");
  assert.deepEqual([w.key, w.bpm, w.lengthSec, w.writers], ["A", 120, 180, "Felix"]);

  // The other song is archived with a pointer; it is no longer listed.
  const gone = (await db.get("songs", blissL))!;
  assert.ok(gone.deletedAt);
  assert.equal(gone.mergedInto, bliss);
  assert.deepEqual((await db.list("songs")).map((s) => s.id).sort(), [bliss, wild, other].sort());
});

test("the kept song's own lyrics doc wins over the others'", async () => {
  await db.update(ctx, "songs", bliss, { lyricsDoc: { driveFileId: "mine", url: "https://example.com/mine" } });
  await merge({ keepId: bliss, mergeIds: [blissL] });
  assert.equal((await db.get("songs", bliss))!.lyricsDoc!.driveFileId, "mine");
});

test("files move (takes too); the same Drive file or link twice stays once", async () => {
  const reh = (await db.create(ctx, "rehearsals", { date: "2026-10-20", personnel: [], songs: [] })).id;
  const a = await file(bliss, { driveFileId: "d1", title: "chart" });
  const dupDrive = await file(blissL, { driveFileId: "d1", title: "chart again" });
  const onlyOther = await file(blissL, { driveFileId: "d2", title: "demo", kind: "demo" });
  const link = await file(bliss, { provider: "spotify", url: "https://open.spotify.com/track/1", title: "spotify" });
  const dupLink = await file(blissL, { provider: "spotify", url: "https://open.spotify.com/track/1", title: "spotify again" });
  const take = await file(blissL, { driveFileId: "t1", kind: "rehearsal", rehearsalId: reh, title: "take" });
  const unrelated = await file(other, { driveFileId: "d9" });

  const r = await merge({ keepId: bliss, mergeIds: [blissL] });
  assert.deepEqual([r.moved.files, r.moved.filesDropped], [2, 2]);
  const live = (await db.list("files")).filter((f) => f.songId === bliss).map((f) => f.id).sort();
  assert.deepEqual(live, [a, link, onlyOther, take].sort());
  assert.ok((await db.get("files", dupDrive))!.deletedAt && (await db.get("files", dupLink))!.deletedAt);
  assert.equal((await db.get("files", take))!.rehearsalId, reh, "a take stays at its rehearsal");
  assert.equal((await db.get("files", unrelated))!.songId, other);
});

test("setlists and templates: items and alternates point at the kept song with its title, length and key; an alternate that becomes its own song is dropped; both on one list stay twice", async () => {
  const items = (rows: Record<string, unknown>[]) => rows;
  const show = "show-1";
  const tpl = (await db.create(ctx, "setlistTemplates", {
    name: "Set", totalSec: 0,
    items: items([
      { type: "song", songId: blissL, title: "The Bliss", lengthSec: 210, key: "G", note: "slow" },
      { type: "break", title: "Break", lengthSec: 900 },
      { type: "song", songId: other, title: "Other Song", lengthSec: 100, key: "C", alts: [{ songId: blissL, title: "The Bliss", key: "G" }, { songId: wild, title: "The Wild Edge" }] },
      { type: "song", songId: bliss, title: "The Bliss", lengthSec: 200, key: "Em", alts: [{ songId: blissL, title: "The Bliss", key: "G" }] },
      { type: "song", songId: wild, title: "The Wild Edge", alts: [{ songId: bliss, title: "The Bliss" }, { songId: blissL, title: "The Bliss" }] },
    ]),
  })).id;
  await db.create(ctx, "setlists", { items: [{ type: "song", songId: blissL, title: "The Bliss", lengthSec: 210, key: "G" }] }, { id: show });
  const only = (await db.create(ctx, "setlistTemplates", { name: "Only", totalSec: 0, items: [{ type: "song", songId: blissL, title: "The Bliss", lengthSec: 210, key: "G" }] })).id;

  const r = await merge({ keepId: bliss, mergeIds: [blissL] });
  assert.equal(r.moved.setlists, 3);
  const t = (await db.get("setlistTemplates", tpl))!;
  const it = t.items as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(it[0], { type: "song", songId: bliss, title: "The Bliss", lengthSec: 200, key: "Em", note: "slow" });
  assert.deepEqual(it[2].alts, [{ songId: bliss, title: "The Bliss", key: "Em" }, { songId: wild, title: "The Wild Edge" }], "an alternate follows the song");
  assert.equal(it[3].songId, bliss);
  assert.equal(it[3].alts, undefined, "an alternate that became the song it is pinned to is dropped");
  assert.deepEqual(it[4].alts, [{ songId: bliss, title: "The Bliss", key: "Em" }], "two alternates that became one stay once");
  assert.equal(it.filter((i) => i.songId === bliss).length, 2, "a song on the list twice plays twice");
  assert.equal(t.totalSec, 200 + 900 + 100 + 200 + 0, "totals follow the new lengths");
  assert.equal(((await db.get("setlistTemplates", only))!.items as any[])[0].songId, bliss); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(((await db.get("setlists", show))!.items as any[])[0].songId, bliss); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test("a filled key and length reach the items already on the kept song", async () => {
  await db.update(ctx, "songs", wild, { title: "The Wild Edge" });
  const tpl = (await db.create(ctx, "setlistTemplates", { name: "Set", totalSec: 0, items: [{ type: "song", songId: wild, title: "The Wild Edge" }, { type: "song", songId: theWild, title: "Wild Edge", lengthSec: 180, key: "A" }] })).id;
  await merge({ keepId: wild, mergeIds: [theWild] });
  const it = (await db.get("setlistTemplates", tpl))!.items as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(it.map((i) => [i.songId, i.title, i.key, i.lengthSec]), [[wild, "The Wild Edge", "A", 180], [wild, "The Wild Edge", "A", 180]]);
});

test("rehearsals: entries move; a rehearsal that had both keeps one entry with the notes joined", async () => {
  const one = (await db.create(ctx, "rehearsals", { date: "2026-10-20", personnel: [], songs: [{ songId: blissL, title: "The Bliss", note: "faster" }, { songId: other, title: "Other Song" }] })).id;
  const both = (await db.create(ctx, "rehearsals", { date: "2026-10-27", personnel: [], songs: [{ songId: other, title: "Other Song" }, { songId: bliss, title: "The Bliss", note: "intro" }, { songId: blissL, title: "The Bliss", note: "faster" }] })).id;
  const same = (await db.create(ctx, "rehearsals", { date: "2026-11-03", personnel: [], songs: [{ songId: bliss, title: "The Bliss", note: "again" }, { songId: blissL, title: "The Bliss", note: "again" }] })).id;
  const r = await merge({ keepId: bliss, mergeIds: [blissL] });
  assert.equal(r.moved.rehearsals, 3);
  assert.deepEqual((await db.get("rehearsals", one))!.songs, [{ songId: bliss, title: "The Bliss", note: "faster" }, { songId: other, title: "Other Song" }]);
  assert.deepEqual((await db.get("rehearsals", both))!.songs, [{ songId: other, title: "Other Song" }, { songId: bliss, title: "The Bliss", note: "intro; faster" }]);
  assert.deepEqual((await db.get("rehearsals", same))!.songs, [{ songId: bliss, title: "The Bliss", note: "again" }]);
});

test("release tracks move; a release with both keeps the earlier track, the other is removed and positions stay dense", async () => {
  const rel = async (title: string) => (await db.create(ctx, "releases", { artistId: TEST_ARTIST, title, kind: "album", projectId: "p" })).id;
  const track = async (releaseId: string, position: number, songId: string, title: string) => (await db.create(ctx, `releases/${releaseId}/tracks`, { releaseId, position, songId, title, status: "tracking", credits: [] })).id;
  const r1 = await rel("Both"), r2 = await rel("One");
  const a = await track(r1, 1, other, "Other Song"), b = await track(r1, 2, blissL, "The Bliss (learning)"), c = await track(r1, 3, bliss, "The Bliss"), d = await track(r1, 4, wild, "The Wild Edge");
  const e = await track(r2, 1, blissL, "The Bliss");
  const mix = await file(undefined, { releaseId: r1, releaseTrackId: c, kind: "mix", title: "mix v1", driveFileId: "mx" });

  const r = await merge({ keepId: bliss, mergeIds: [blissL] });
  assert.deepEqual([r.moved.releases, r.moved.tracksDropped], [2, 1]);
  const t1 = (await db.list(`releases/${r1}/tracks`)).sort((x, y) => x.position - y.position);
  assert.deepEqual(t1.map((t) => [t.id, t.position, t.songId]), [[a, 1, other], [b, 2, bliss], [d, 3, wild]]);
  assert.ok((await db.get(`releases/${r1}/tracks`, c))!.deletedAt);
  assert.equal((await db.get("files", mix))!.releaseTrackId, b, "the removed track's release files go to the track that stays");
  assert.equal((await db.get(`releases/${r2}/tracks`, e))!.songId, bliss);
});

test("undo restores every song and reference", async () => {
  const reh = (await db.create(ctx, "rehearsals", { date: "2026-10-20", personnel: [], songs: [{ songId: blissL, title: "The Bliss", note: "faster" }, { songId: bliss, title: "The Bliss" }] })).id;
  await db.create(ctx, "setlistTemplates", { name: "Set", totalSec: 0, items: [{ type: "song", songId: blissL, title: "The Bliss", lengthSec: 210, key: "G", alts: [{ songId: bliss, title: "The Bliss" }] }] });
  await file(bliss, { driveFileId: "d1" });
  await file(blissL, { driveFileId: "d1" });
  await file(blissL, { driveFileId: "d2" });
  const rl = (await db.create(ctx, "releases", { artistId: TEST_ARTIST, title: "R", kind: "album", projectId: "p" })).id;
  await db.create(ctx, `releases/${rl}/tracks`, { releaseId: rl, position: 1, songId: blissL, title: "A", status: "tracking", credits: [] });
  await db.create(ctx, `releases/${rl}/tracks`, { releaseId: rl, position: 2, songId: bliss, title: "B", status: "tracking", credits: [] });

  const before = await snapshot();
  const runCtx = { ...ctx, runId: newRunId() };
  await merge({ keepId: bliss, mergeIds: [blissL] }, runCtx);
  assert.notDeepEqual(await snapshot(), before);
  const report = await undoRun(ctx, runCtx.runId);
  assert.equal(report.failed.length, 0);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await db.get("songs", blissL))!.deletedAt, null);
  assert.equal((await db.get("rehearsals", reh))!.songs.length, 2);
});

test("one run covers it all, so History can undo it", async () => {
  await file(blissL, { driveFileId: "d2" });
  const runCtx = { ...ctx, runId: newRunId() };
  await merge({ keepId: bliss, mergeIds: [blissL] }, runCtx);
  const rows = await db.listGroup("history", (q) => q.where("runId", "==", runCtx.runId));
  assert.ok(rows.some((h) => h.entity.kind === "songs" && h.entity.id === bliss && h.diff.mergedFrom), "the kept song's history says what was merged in");
  assert.ok(rows.some((h) => h.entity.kind === "files") && rows.some((h) => h.entity.id === blissL && h.op === "delete"));
});

test("three songs at once; refusals", async () => {
  await merge({ keepId: bliss, mergeIds: [blissL, blissL, other] });
  assert.equal((await db.get("songs", other))!.mergedInto, bliss);
  assert.equal(((await db.get("songs", bliss))!.mergedFrom as unknown[]).length, 2);
  await code(merge({ keepId: wild, mergeIds: [wild] }), "invalid_input");
  await code(merge({ keepId: wild, mergeIds: ["nope"] }), "not_found");
  await code(merge({ keepId: wild, mergeIds: [blissL] }), "not_found"); // already merged away
  await code(merge({ keepId: "nope", mergeIds: [wild] }), "not_found");
  assert.deepEqual(registry["songs.merge"].roles.sort(), ["admin", "mcp"]);
});

