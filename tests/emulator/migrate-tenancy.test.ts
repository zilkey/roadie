/**
 * Tenancy phase 3 backfill (scripts/migrate-tenancy.ts) on two seeded artists turned back into their pre-phase-2 shape: no
 * `artistId` on the kinds that had none, History entries without their scope, users without `artistIds` or
 * `Membership.musicianId`, statSnapshots under their old `{source}_{date}` ids. Always on the top-level layout, the only one phase 3
 * knew (tenancy phase 10 nests artist data later).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc } from "firebase/firestore";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { z } from "zod";
import { adminAuth, firestore } from "@/server/admin";
import { collections } from "@/schema";
import { PARENTS } from "@/schema/owners";
import { claimsFor } from "@/server/session";
import { snapshotId } from "@/server/commands/stats";
import { migrateTenancy, formatReport, undoSnapshots, legacySnapshotId } from "../../scripts/migrate-tenancy";
import { syncAllClaims } from "../../scripts/sync-claims";
import { makeUser, resetEmulators } from "./helpers";
import { forgetLayout, layout } from "@/server/layout";
import { ARTIST_KINDS, seedArtists } from "./fixtures";

type Scope = { artistId: unknown; ownerUid?: unknown; shared?: unknown; entityId: unknown };
let fs: Firestore;
let seeded: Awaited<ReturnType<typeof seedArtists>>;
/** After seeding, as phase 2 stamped it: each artist record's artistId, each History entry's scope (statSnapshots under their new ids). */
const recordArtist = new Map<string, string>();
const historyScope = new Map<string, Scope>();
/** Records per kind per artist, as seeded. */
const tally: Record<string, Record<string, number>> = {};

/** The artist kinds that had no `artistId` before phase 2 (plan D2), so prod held them without one. */
const LEGACY_KINDS: string[] = ["songs", "files", "setlists", "setlistTemplates", "rehearsals", "expenses", "availability", "showDeals", "emailTemplates", "statSnapshots", "musicians", "comments", "activity", "entries", "tracks", "assistantThreads", "stagePlots", "mcpTokens"].filter((k) => (ARTIST_KINDS as string[]).includes(k));

const docsOf = async (kind: string) => {
  const sub = !!PARENTS[kind] && !PARENTS[kind].keyedById;
  return (sub ? await fs.collectionGroup(kind).get() : await fs.collection(kind).get()).docs;
};
const scopeOf = (d: FirebaseFirestore.DocumentData): Scope => ({
  artistId: d.artistId, ownerUid: d.ownerUid, shared: d.shared, entityId: (d.entity as { id: string }).id,
});

/** Turn the seeded data back into what prod held before phase 2. */
async function toLegacyShape() {
  for (const kind of LEGACY_KINDS) for (const d of await docsOf(kind)) await d.ref.update({ artistId: FieldValue.delete() });
  for (const h of (await fs.collectionGroup("history").get()).docs) {
    const rec = await h.ref.parent.parent!.get();
    await h.ref.update({ artistId: (rec.get("artistId") as string | undefined) ?? null, ownerUid: FieldValue.delete(), shared: FieldValue.delete() });
  }
  for (const u of (await fs.collection("users").get()).docs) {
    // Before phase 2 the link was users.musicianId; memberships carried none.
    const raw = u.get("artists") as { musicianId?: string }[];
    const ms = raw.map(({ musicianId: _m, ...rest }) => (void _m, rest));
    const linked = raw.find((m) => m.musicianId)?.musicianId;
    await u.ref.update({ artistIds: FieldValue.delete(), artists: ms, ...(linked ? { musicianId: linked } : {}) });
  }
  // Old ids carry no artist, so only one artist can hold a given day under them: a's goes back to its old id, b's stays prefixed.
  for (const s of (await fs.collection("statSnapshots").get()).docs) {
    if (!s.id.startsWith("a_")) continue;
    const old = fs.collection("statSnapshots").doc(legacySnapshotId(s.get("source"), s.get("date")));
    const { artistId: _a, ...data } = s.data();
    void _a;
    await old.set(data);
    for (const h of (await s.ref.collection("history").get()).docs) {
      await old.collection("history").doc(h.id).set({ ...h.data(), artistId: null, entity: { ...h.get("entity"), id: old.id } });
      await h.ref.delete();
    }
    await s.ref.delete();
  }
}

before(async () => {
  // The phase-3 backfill ran on (and only knows) the top-level layout, long before phase 10 moved artist data under artists/{id}.
  process.env.ROADIE_NESTED_PATHS = "0";
  forgetLayout();
  await layout();
  await resetEmulators();
  fs = firestore();
  seeded = await seedArtists("a", "b");
  for (const kind of ARTIST_KINDS) {
    for (const d of await docsOf(kind)) {
      const a = d.get("artistId") as string;
      assert.ok(a, `${d.ref.path} was stamped by the Writer`);
      recordArtist.set(d.ref.path, a);
      (tally[kind] ??= {})[a] = (tally[kind][a] ?? 0) + 1;
    }
  }
  for (const h of (await fs.collectionGroup("history").get()).docs) historyScope.set(h.ref.path, scopeOf(h.data()));
  await toLegacyShape();
});

test("the fixtures seed every artist kind in both artists, and the legacy shape drops artistId where it was optional", () => {
  for (const kind of ARTIST_KINDS) {
    assert.ok(tally[kind]?.a && tally[kind]?.b, `${kind} has a record in a and b`);
  }
  assert.ok(LEGACY_KINDS.includes("songs") && LEGACY_KINDS.includes("musicians") && LEGACY_KINDS.includes("comments"), LEGACY_KINDS.join(","));
  assert.ok(!LEGACY_KINDS.includes("shows"));
});

test("dry run: counts per kind and artist, an orphan and a conflict, and apply refuses until both are gone", async () => {
  // A song whose creator isn't a person: the --artist artist. A song by someone in b and c only: an orphan.
  // A comment on a's show by b's admin (only in b): a conflict.
  await fs.collection("songs").doc("by-import").set({ title: "Imported", status: "active", createdBy: "import", deletedAt: null, rev: 1 });
  const multi = await makeUser("multi@b-c.example", "member", { artists: [{ artistId: "b", role: "member" }, { artistId: "c", role: "admin" }] });
  await fs.collection("songs").doc("by-multi").set({ title: "Whose?", status: "active", createdBy: multi.uid, deletedAt: null, rev: 1 });
  await fs.doc(`shows/${seeded.A.refs.shows}/comments/cross`).set({ authorId: seeded.B.admin.uid, body: "hi", createdBy: seeded.B.admin.uid, deletedAt: null, rev: 1 });

  const r = await migrateTenancy({ artist: "a", apply: false });
  assert.deepEqual(r.orphans.map((o) => o.path), ["songs/by-multi"]);
  assert.deepEqual(r.conflicts.map((c) => c.path), [`shows/${seeded.A.refs.shows}/comments/cross`]);
  assert.match(formatReport(r), /1 orphans, 1 conflicts/);
  for (const kind of ARTIST_KINDS) {
    const want = { ...tally[kind] };
    if (kind === "songs") want.a += 1; // by-import
    if (kind === "comments") want.a += 1; // the conflicting one still counts under its parent
    assert.deepEqual(r.kinds[kind].byArtist, want, `${kind} per artist`);
    const stamped = Object.values(r.kinds[kind].toStamp).reduce((x, y) => x + y, 0);
    assert.equal(stamped > 0, LEGACY_KINDS.includes(kind), `${kind}: stamped only when it had no artistId`);
  }
  assert.equal(r.kinds.songs.via.notAUser, 1);
  assert.equal(r.kinds.musicians.toStamp.b, tally.musicians.b, "b's musicians land in b");
  assert.equal(r.snapshots.toMove, 1);
  assert.ok(r.history.toStamp > 0);
  await assert.rejects(migrateTenancy({ artist: "a", apply: true }), /Refusing to apply: 1 orphan\(s\) and 1 conflict\(s\)/);

  await fs.doc("songs/by-multi").delete();
  await fs.doc(`shows/${seeded.A.refs.shows}/comments/cross`).delete();
  await fs.recursiveDelete(fs.collection("users").doc(multi.uid));
});

test("apply stamps every record and History entry without touching rev or updatedAt; a second dry run is empty", async () => {
  const song = (await fs.doc(`songs/${seeded.B.refs.songs}`).get()).data()!;
  const r = await migrateTenancy({ artist: "a", apply: true });
  assert.deepEqual(r.failed, []);
  assert.ok(r.left > 0);

  for (const kind of ARTIST_KINDS) {
    for (const d of await docsOf(kind)) {
      if (d.id === "by-import") { assert.equal(d.get("artistId"), "a"); continue; }
      assert.equal(d.get("artistId"), recordArtist.get(d.ref.path), d.ref.path);
    }
  }
  const after = (await fs.doc(`songs/${seeded.B.refs.songs}`).get()).data()!;
  assert.equal(after.rev, song.rev);
  assert.deepEqual(after.updatedAt, song.updatedAt);
  assert.equal(after.updatedBy, song.updatedBy);

  const entries = (await fs.collectionGroup("history").get()).docs;
  assert.equal(entries.length, historyScope.size, "no History written or lost");
  for (const h of entries) assert.deepEqual(scopeOf(h.data()), historyScope.get(h.ref.path), h.ref.path);

  // The stranger's musician (b's) is in b, and b's admin's membership in b names it.
  const bMusician = (await fs.doc(`musicians/${seeded.B.refs.musicianId}`).get()).data()!;
  assert.equal(bMusician.artistId, "b");
  const bAdmin = (await fs.doc(`users/${seeded.B.admin.uid}`).get()).data()!;
  assert.deepEqual(bAdmin.artistIds, ["b"]);
  assert.equal(bAdmin.artists[0].musicianId, seeded.B.refs.musicianId);
  const both = (await fs.doc(`users/${seeded.both.uid}`).get()).data()!;
  assert.deepEqual(both.artistIds, ["a", "b"]);

  const again = await migrateTenancy({ artist: "a", apply: false });
  assert.equal(again.left, 0, formatReport(again));
  assert.deepEqual([again.orphans, again.conflicts], [[], []]);
});

test("sync-claims gives tokens adminOf and musicians", async () => {
  const dry = await syncAllClaims({ apply: false });
  assert.ok(dry.changed.length >= 4);
  await syncAllClaims({ apply: true });
  const u = await adminAuth().getUser(seeded.A.member.uid);
  assert.deepEqual(u.customClaims, { artists: { a: "member" }, adminOf: [], musicians: { a: seeded.A.refs.memberMusicianId } });
  assert.deepEqual((await adminAuth().getUser(seeded.both.uid)).customClaims?.adminOf, ["b"]);
  assert.equal((await syncAllClaims({ apply: false })).changed.length, 0);
});

test("an old users History entry, once scoped, is unreadable by another artist's admin and member under the phase-6 rule", async () => {
  // The D6 History rule (tenancy plan); firestore.rules itself changes in phase 6.
  const rules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function roles() { return signedIn() ? request.auth.token.get('artists', {}) : {}; }
    function admin(a) { return roles().get(a, '') == 'admin'; }
    function anyAdmin() { return signedIn() && request.auth.token.get('adminOf', []).size() > 0; }
    match /{path=**}/history/{rev} {
      allow read: if (resource.data.get('artistId', null) != null && admin(resource.data.artistId))
                  || (signedIn() && resource.data.get('ownerUid', null) == request.auth.uid)
                  || (resource.data.get('shared', false) == true && anyAdmin());
    }
  }
}`;
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8280").split(":");
  const env = await initializeTestEnvironment({ projectId: process.env.GCLOUD_PROJECT ?? "demo-band-tracker", firestore: { rules, host, port: Number(port) } });
  const owner = seeded.A.member.uid;
  const [entry] = (await fs.collection(`users/${owner}/history`).get()).docs;
  assert.ok(entry, "the member's users doc has History");
  const as = async (uid: string) => {
    const claims = claimsFor((await fs.doc(`users/${uid}`).get()).data()!);
    return env.authenticatedContext(uid, claims).firestore();
  };
  const read = async (uid: string) => getDoc(doc(await as(uid), entry.ref.path)).then(() => true, () => false);
  assert.equal(await read(owner), true, "the person reads their own");
  assert.equal(await read(seeded.B.admin.uid), false, "another artist's admin can't");
  assert.equal(await read(seeded.B.member.uid), false, "another artist's member can't");
  assert.equal(await read(seeded.A.admin.uid), false, "nor their own artist's admin: a person's History is theirs");
  // A venue's (shared) entry is readable by any admin; a's show entry only by a's admin.
  const [venueEntry] = (await fs.collection("venues/fx-venue/history").get()).docs;
  assert.equal(await getDoc(doc(await as(seeded.B.admin.uid), venueEntry.ref.path)).then(() => true, () => false), true);
  const [showEntry] = (await fs.collection(`shows/${seeded.A.refs.shows}/history`).get()).docs;
  assert.equal(await getDoc(doc(await as(seeded.B.admin.uid), showEntry.ref.path)).then(() => true, () => false), false);
  assert.equal(await getDoc(doc(await as(seeded.A.admin.uid), showEntry.ref.path)).then(() => true, () => false), true);
  await env.cleanup();
});

test("--undo-snapshots deletes the prefixed copies once a restore brings the old ids back", async () => {
  const moved = await fs.doc(`statSnapshots/${snapshotId("a", "spotifyApi", "2027-05-01")}`).get();
  assert.ok(moved.exists && (await fs.doc(`statSnapshots/${snapshotId("b", "spotifyApi", "2027-05-01")}`).get()).exists);
  assert.deepEqual((await undoSnapshots({ apply: false })).paths, [], "nothing to undo while the old ids are gone");
  // What `npm run restore` of the pre-migration backup does: the old-id doc comes back as it was.
  const { artistId: _a, ...data } = moved.data()!;
  void _a;
  await fs.collection("statSnapshots").doc(legacySnapshotId("spotifyApi", "2027-05-01")).set(data);
  // A snapshot written fresh after the backup has no old twin and stays; so does b's (same day, its own createdAt).
  await fs.collection("statSnapshots").doc(snapshotId("a", "instagram", "2027-06-01")).set({ artistId: "a", source: "instagram", date: "2027-06-01", createdAt: new Date() });
  const r = await undoSnapshots({ apply: true });
  assert.deepEqual(r.paths, [moved.ref.path]);
  const left = (await fs.collection("statSnapshots").get()).docs.map((d) => d.id).sort();
  assert.deepEqual(left, ["a_instagram_2027-06-01", "b_spotifyApi_2027-05-01", "spotifyApi_2027-05-01"]);
  assert.equal((await moved.ref.collection("history").get()).size, 0);
});
