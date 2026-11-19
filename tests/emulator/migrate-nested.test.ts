/**
 * Tenancy phase 10 on two seeded artists: scripts/migrate-nested.ts copies every artist record with its History under its artist,
 * verifies, and leaves Roadie read-only; after the flip the app reads and writes the nested copies; scripts/delete-flat-copies.ts
 * removes the old ones; --reverse copies back. Also phase 7's scripts/drop-user-musician-id.ts and its --undo.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { firestore } from "@/server/admin";
import { db, run } from "@/server/db";
import { forgetLayout, layout } from "@/server/layout";
import { linkedArtist } from "@/server/links";
import { undoRun } from "@/server/undo";
import { formatNestReport, migrateNested } from "../../scripts/migrate-nested";
import { deleteFlatCopies } from "../../scripts/delete-flat-copies";
import { dropUserMusicianId } from "../../scripts/drop-user-musician-id";
import { resetEmulators, SYS } from "./helpers";
import { seedArtists, type SeededArtist } from "./fixtures";

const layoutTo = async (nested: boolean) => { process.env.ROADIE_NESTED_PATHS = nested ? "1" : "0"; forgetLayout(); await layout(); };
const config = (patch: Record<string, unknown>) => firestore().doc("platform/config").set(patch, { merge: true }).then(() => forgetLayout());
const admin = (s: SeededArtist) => ({ uid: s.admin.uid, role: "admin" as const, via: "app" as const, runId: `r-${Math.random()}`, artistId: s.artistId });
let A: SeededArtist, B: SeededArtist;

before(async () => {
  await resetEmulators();
  await layoutTo(false);
  ({ A, B } = await seedArtists("a", "b"));
});

test("dry run: counts per kind per artist, and problems block --apply", async () => {
  const fs = firestore();
  // A record nobody can place, and a History entry that names its record wrongly.
  await fs.doc("songs/orphan").set({ id: "orphan", title: "Who?", deletedAt: null });
  await fs.doc(`shows/${A.refs.shows}/history/999999`).set({ artistId: "a", entity: { kind: "showz", id: "nope" }, createdAt: new Date() });
  const dry = await migrateNested({ apply: false });
  assert.equal(dry.counts.a.shows, 1);
  assert.equal(dry.counts.b.shows, 1);
  assert.ok(dry.counts.a["shows/history"] >= 2, "a show's History goes with it");
  assert.equal(dry.counts.a["shows/comments"], 1);
  assert.equal(dry.counts.a["releases/tracks"], 1);
  assert.equal(dry.counts.a.mcpTokens, undefined, "kinds kept top level don't move");
  assert.equal(dry.counts.a.assistantThreads, undefined);
  assert.equal(dry.historyRewritten, 1);
  assert.deepEqual(dry.problems.map((p) => p.path), ["songs/orphan"]);
  const refused = await migrateNested({ apply: true, settleMs: 0 });
  assert.equal(refused.copied, 0);
  assert.equal((await fs.doc("platform/config").get()).data()?.readOnly, undefined, "nothing changed, not even read-only");
  assert.equal((await fs.collection("artists/a/shows").get()).size, 0);
  await fs.doc("songs/orphan").delete();
});

test("--apply copies everything exactly, rewrites the History path, adds the link index, verifies, and stays read-only", async () => {
  const fs = firestore();
  const before = (await fs.doc(`shows/${A.refs.shows}`).get()).data()!;
  const r = await migrateNested({ apply: true, settleMs: 0 });
  forgetLayout(); // a server picks read-only up within seconds (SETTLE_MS covers it on prod)
  assert.deepEqual(r.problems, []);
  assert.ok(r.verified, formatNestReport(r));
  assert.equal(r.historyRewritten, 1);
  const nested = (await fs.doc(`artists/a/shows/${A.refs.shows}`).get()).data()!;
  assert.deepEqual(nested, before, "same data, revs and timestamps");
  assert.deepEqual((await fs.doc(`artists/a/shows/${A.refs.shows}/history/999999`).get()).data()?.entity, { kind: "shows", id: A.refs.shows });
  assert.ok((await fs.doc(`artists/b/pitches/${B.refs.pitches}/activity/${B.records.activity.id}`).get()).exists);
  assert.ok((await fs.doc(`artists/a/releases/${A.refs.releases}/tracks/${A.records.tracks.id}`).get()).exists);
  assert.ok((await fs.doc(`mcpTokens/${A.records.mcpTokens.id}`).get()).exists, "kept top level");
  assert.equal((await fs.collection("artists/a/mcpTokens").get()).size, 0);
  assert.equal(await linkedArtist("availability", A.records.availability.id), "a");
  assert.equal(await linkedArtist("stagePlots", B.records.stagePlots.id), "b");
  assert.equal((await fs.doc("platform/config").get()).data()?.readOnly, true);
  // Read-only: no write goes through, reads still answer.
  await assert.rejects(run(admin(A), (w) => w.update("songs", A.refs.songs, { title: "Nope" })), { code: "read_only" });
  assert.ok(await db.get(admin(A), "songs", A.refs.songs));
  // Run again: nothing left to copy.
  const again = await migrateNested({ apply: true, settleMs: 0 });
  assert.equal(again.copied, 0);
  assert.ok(again.alreadyThere > 0 && again.verified);
});

test("after the flip the app reads and writes the nested copies, scoped by path; undo works there", async () => {
  await config({ nestedPaths: true, readOnly: false });
  await layoutTo(true);
  const fs = firestore();
  const a = admin(A);
  assert.equal((await db.get(a, "shows", A.refs.shows))?.id, A.refs.shows);
  assert.equal(await db.get(a, "shows", B.refs.shows), null, "B's show isn't in A's subtree");
  assert.deepEqual((await db.list(a, "shows")).map((s) => s.id), [A.refs.shows]);
  // A write lands nested only, with its History next to it; the top-level copy is left as it was.
  await run(a, (w) => w.update("songs", A.refs.songs, { title: "Glass Coast (live)" }));
  assert.equal((await fs.doc(`artists/a/songs/${A.refs.songs}`).get()).data()?.title, "Glass Coast (live)");
  assert.equal((await fs.doc(`songs/${A.refs.songs}`).get()).data()?.title, "Glass Coast");
  const hist = await db.history(a, "songs", A.refs.songs);
  assert.equal(hist[0].diff.title.after, "Glass Coast (live)");
  assert.equal(hist[0].entity.kind, "songs", "History names the record by its logical path");
  // Collection groups see one copy of each record: the nested one.
  const tracks = await db.listGroup(a, "tracks");
  assert.deepEqual(tracks.map((t) => t.path), [`artists/a/releases/${A.refs.releases}/tracks/${A.records.tracks.id}`]);
  // Undo reverses it through History's logical path.
  await undoRun(a, a.runId);
  assert.equal((await fs.doc(`artists/a/songs/${A.refs.songs}`).get()).data()?.title, "Glass Coast");
  // A sub-collection create takes its parent's artist and path; a rename of a shared venue reaches every artist's nested shows.
  const c = await db.create(a, `pitches/${A.refs.pitches}/comments`, { authorId: a.uid, body: "Nested" });
  assert.ok((await fs.doc(`artists/a/pitches/${A.refs.pitches}/comments/${c.id}`).get()).exists);
  await db.update(SYS, "venues", A.refs.venueId, { name: "Renamed Room" });
  for (const s of ["a", "b"]) {
    const show = (await fs.collection(`artists/${s}/shows`).get()).docs[0].data();
    assert.equal(show.venue.name, "Renamed Room", `${s}'s nested show follows the rename`);
  }
});

test("delete-flat-copies: only with nested paths on; keeps a record changed since the copy; then --reverse copies back", async () => {
  const fs = firestore();
  await config({ nestedPaths: false });
  await assert.rejects(deleteFlatCopies({ apply: false }), /nestedPaths is off/);
  await config({ nestedPaths: true });
  // Changed nested since the copy (the song's edit and undo, the venue rename on both shows): the top-level copies are just older. Gone.
  // A write that reached the old layout after the copy (a server still on it): kept, and so is a record only the top level has.
  const late = (await fs.doc(`songs/${B.refs.songs}`).get()).data()!;
  await fs.doc(`songs/${B.refs.songs}`).set({ ...late, title: "Late write", rev: late.rev + 5, updatedAt: new Date(Date.now() + 60_000) });
  await fs.doc("songs/flat-only").set({ ...late, id: "flat-only" });
  const dry = await deleteFlatCopies({ apply: false });
  assert.equal(dry.deleted.shows, 2);
  assert.deepEqual(dry.kept.map((k) => k.path).filter((p) => !p.includes("/history/")).sort(), ["songs/flat-only", `songs/${B.refs.songs}`].sort(), JSON.stringify(dry.kept));
  await deleteFlatCopies({ apply: true });
  assert.equal((await fs.collection("shows").get()).size, 0);
  assert.equal((await fs.collection("pitches").get()).size, 0, "sub-collections and History go with their record");
  assert.deepEqual((await fs.collection("songs").get()).docs.map((d) => d.id).sort(), ["flat-only", B.refs.songs].sort(), "the late write and the flat-only record are kept");
  assert.ok((await fs.doc(`artists/a/shows/${A.refs.shows}`).get()).exists);
  // Rollback after the delete: copy the nested records back to the top level.
  for (const id of ["flat-only", B.refs.songs]) await fs.recursiveDelete(fs.doc(`songs/${id}`));
  const back = await migrateNested({ apply: true, direction: "flatten", settleMs: 0 });
  assert.ok(back.verified, formatNestReport(back));
  assert.equal((await fs.doc(`songs/${A.refs.songs}`).get()).data()?.title, "Glass Coast");
  assert.ok((await fs.doc(`pitches/${A.refs.pitches}/activity/${A.records.activity.id}`).get()).exists);
  await config({ readOnly: false });
});

test("phase 7: drop-user-musician-id moves the old link onto the membership and drops it; --undo writes it back", async () => {
  const fs = firestore();
  await fs.doc("users/old").set({ id: "old", email: "old@a.example", name: "Old", artists: [{ artistId: "a", role: "member" }], artistIds: ["a"], musicianId: A.refs.memberMusicianId, deletedAt: null });
  const dry = await dropUserMusicianId({ apply: false });
  assert.deepEqual(dry.changes.map((c) => [c.uid, c.from, c.linked]), [["old", A.refs.memberMusicianId, "a"]]);
  assert.equal((await fs.doc("users/old").get()).data()?.musicianId, A.refs.memberMusicianId, "dry run changes nothing");
  await dropUserMusicianId({ apply: true });
  const u = (await fs.doc("users/old").get()).data()!;
  assert.equal("musicianId" in u, false);
  assert.deepEqual(u.artists, [{ artistId: "a", role: "member", musicianId: A.refs.memberMusicianId }]);
  assert.equal((await dropUserMusicianId({ apply: false })).changes.length, 0, "a second run has nothing to do");
  const undo = await dropUserMusicianId({ apply: true, undo: true });
  assert.ok(undo.changes.some((c) => c.uid === "old" && c.to === A.refs.memberMusicianId));
  assert.equal((await fs.doc("users/old").get()).data()?.musicianId, A.refs.memberMusicianId);
});
