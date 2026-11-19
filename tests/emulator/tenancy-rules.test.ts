/**
 * Tenancy phase 6: firestore.rules (plan D6) on two seeded artists, driven by OWNERS and `seedArtist` (tests/emulator/fixtures.ts).
 * Tokens carry the claims the server really sets (`claimsFor` of the users doc: `artists`, `adminOf`, `musicians`).
 *
 * - For every artist kind, A's admin and A's member can neither get nor filtered-list B's record.
 * - The person who is a member of A and an admin of B reads B as its admin and A only as a member.
 * - A's own records read wherever the rules allow them; a get of a missing doc in A's kinds reads as "doesn't exist".
 * - History entries of all three scopes (artist, person, shared).
 * - A person in two artists with a musician in each reads only their own payouts and availability, in each.
 * - People lists: an admin lists the users of their own artist (by artistIds), never another's or everyone.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { firestore } from "@/server/admin";
import { claimsFor } from "@/server/session";
import { db } from "@/server/db";
import { OWNERS, physicalPath } from "@/schema/owners";
import { makeUser, resetEmulators, SYS } from "./helpers";
import { ARTIST_KINDS, seedArtists, SUB_KINDS, type SeededArtist } from "./fixtures";

let env: RulesTestEnvironment;
type ClientDb = ReturnType<ReturnType<RulesTestEnvironment["authenticatedContext"]>["firestore"]>;
let A: SeededArtist, B: SeededArtist, both: { uid: string };
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8280").split(":");

/** Kinds with no client rule: the server reads them for the browser (invites through commands, tokens on the server). */
const SERVER_ONLY = new Set(["invites", "shortcutTokens"]);
/** Kinds every member of the artist reads (live records). */
const MEMBER_READS = new Set(["shows", "tours", "entries", "projects", "songs", "files", "setlists", "setlistTemplates", "rehearsals", "stagePlots", "musicians"]);
/** Kinds a member reads only their own of (the samples are the admin's, so the member reads none of them). */
const MEMBER_OWN = new Set(["expenses", "availability", "payouts"]);
/** Kinds keyed by the artist id itself (no artistId filter is needed: the doc id is the artist). */
const KEYED_BY_ARTIST = new Set(["socialChecklists"]);
/** Kinds only their owner reads (userId / ownerUid == me): never listed by the browser; the owner test below covers them. */
const OWNER_ONLY = new Set(["mcpTokens", "assistantThreads"]);

before(async () => {
  await resetEmulators();
  const s = await seedArtists("a", "b");
  A = s.A; B = s.B; both = s.both;
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT ?? "demo-band-tracker",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host, port: Number(port) },
  });
});
after(async () => { await env?.cleanup(); });

/** Where `path` (a collection or a doc, written logically: "shows", "payouts/x") is stored for artist `s` in this run's layout. */
const at = (s: SeededArtist | string, path: string) => physicalPath(path, typeof s === "string" ? s : s.artistId);

/** A client Firestore signed in as `uid`, with the claims the server sets from their users doc. */
async function as(uid: string): Promise<ClientDb> {
  const user = (await firestore().doc(`users/${uid}`).get()).data();
  assert.ok(user, `users/${uid} exists`);
  return env.authenticatedContext(uid, claimsFor(user)).firestore();
}

/** The filtered list the browser sends for one kind (src/lib/client-scope.ts): artistId == <artist>, live only. */
function list(c: ClientDb, s: SeededArtist, kind: string, artistId = s.artistId) {
  const { path } = s.records[kind as keyof typeof s.records];
  const filters = KEYED_BY_ARTIST.has(kind) ? [] : [where("artistId", "==", artistId)];
  if (kind === "entries") filters.push(where("visibility", "==", "band")); // what a member's tour page sends
  return getDocs(query(collection(c, at(s, path)), ...filters, where("deletedAt", "==", null)));
}
const get = (c: ClientDb, s: SeededArtist, kind: string) => {
  const { path, id } = s.records[kind as keyof typeof s.records];
  return getDoc(doc(c, at(s, path), id));
};

test("every artist kind in OWNERS has a seed fixture and a rule decision here", () => {
  for (const kind of ARTIST_KINDS) assert.ok(A.records[kind], `no seed fixture for ${kind}`);
  assert.deepEqual(ARTIST_KINDS.filter((k) => OWNERS[k] !== "artist"), []);
});

test("another artist's records: A's admin and A's member can neither get nor list B's, of any kind", async () => {
  const [admin, member] = [await as(A.admin.uid), await as(A.member.uid)];
  for (const kind of ARTIST_KINDS) {
    for (const [who, c] of [["A's admin", admin], ["A's member", member]] as const) {
      await assertFails(get(c, B, kind)).catch(() => assert.fail(`${who} got B's ${kind}`));
      await assertFails(list(c, B, kind)).catch(() => assert.fail(`${who} listed B's ${kind}`));
    }
  }
});

test("A's own records: its admin reads every kind with a rule; its member reads the band kinds only", async () => {
  const [admin, member] = [await as(A.admin.uid), await as(A.member.uid)];
  for (const kind of ARTIST_KINDS) {
    if (SERVER_ONLY.has(kind)) {
      for (const c of [admin, member]) { await assertFails(get(c, A, kind)); await assertFails(list(c, A, kind)); }
      continue;
    }
    await assertSucceeds(get(admin, A, kind)).catch(() => assert.fail(`A's admin can't get A's ${kind}`));
    if (!KEYED_BY_ARTIST.has(kind) && !OWNER_ONLY.has(kind)) await assertSucceeds(list(admin, A, kind)).catch(() => assert.fail(`A's admin can't list A's ${kind}`));
    const ok = MEMBER_READS.has(kind);
    await (ok ? assertSucceeds(get(member, A, kind)) : assertFails(get(member, A, kind))).catch(() => assert.fail(`A's member ${ok ? "can't" : "can"} get A's ${kind}`));
    if (!MEMBER_OWN.has(kind) && !KEYED_BY_ARTIST.has(kind)) {
      await (ok ? assertSucceeds(list(member, A, kind)) : assertFails(list(member, A, kind))).catch(() => assert.fail(`A's member ${ok ? "can't" : "can"} list A's ${kind}`));
    }
  }
});

test("member of A and admin of B: B as its admin, A only as a member", async () => {
  const c = await as(both.uid);
  for (const kind of ARTIST_KINDS) {
    if (SERVER_ONLY.has(kind) || kind === "mcpTokens" || kind === "assistantThreads") continue; // those are their owner's alone
    await assertSucceeds(get(c, B, kind)).catch(() => assert.fail(`B's admin can't get B's ${kind}`));
    const ok = MEMBER_READS.has(kind);
    await (ok ? assertSucceeds(get(c, A, kind)) : assertFails(get(c, A, kind))).catch(() => assert.fail(`A's member ${ok ? "can't" : "can"} get A's ${kind}`));
  }
  // An unfiltered list never passes, even for someone with a role in both.
  // (Nested, the path is the artist: a member's list then only needs the soft-delete filter; tenancy-rules-nested.test.ts.)
  await assertFails(getDocs(collection(c, "shows")));
  await assertFails(getDocs(query(collection(c, at(A, "pitches")), where("artistId", "==", A.artistId))));
  await assertSucceeds(getDocs(query(collection(c, at(B, "pitches")), where("artistId", "==", B.artistId))));
});

test("a get of a missing doc in an artist kind reads as 'doesn't exist'; an anonymous or role-less one still fails", async () => {
  for (const uid of [A.admin.uid, A.member.uid]) {
    const c = await as(uid);
    for (const path of ["shows/none", "showDeals/none", "setlists/none", "setlistTemplates/none", "rehearsals/none", "tours/none", "pitches/none", "payouts/none", "expenses/none"]) {
      const snap = await assertSucceeds(getDoc(doc(c, at(A, path))));
      assert.equal(snap.exists(), false, path);
    }
  }
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), at(A, "shows/none"))));
  await assertFails(getDoc(doc(env.authenticatedContext("no-band", { artists: {}, adminOf: [], musicians: {} }).firestore(), at(A, "shows/none"))));
});

test("server-only and owner-only kinds: mcpTokens and Roadie threads read only by their owner, as an admin of that artist", async () => {
  // The samples belong to A's admin.
  await assertSucceeds(get(await as(A.admin.uid), A, "mcpTokens"));
  await assertSucceeds(get(await as(A.admin.uid), A, "assistantThreads"));
  await assertSucceeds(getDocs(query(collection(await as(A.admin.uid), "mcpTokens"), where("artistId", "==", A.artistId), where("userId", "==", A.admin.uid))));
  await assertSucceeds(getDocs(query(collection(await as(A.admin.uid), "assistantThreads"), where("artistId", "==", A.artistId), where("ownerUid", "==", A.admin.uid))));
  await assertFails(getDocs(query(collection(await as(A.admin.uid), "mcpTokens"), where("artistId", "==", A.artistId))));
  const other = await makeUser("second-admin@a.example", "admin", { artistId: A.artistId });
  await assertFails(get(await as(other.uid), A, "mcpTokens"));
  await assertFails(get(await as(other.uid), A, "assistantThreads"));
  // A thread's messages follow the thread.
  const thread = A.records.assistantThreads.id;
  await firestore().doc(`assistantThreads/${thread}/messages/m1`).set({ role: "user", text: "Hi", at: new Date() });
  await assertSucceeds(getDoc(doc(await as(A.admin.uid), `assistantThreads/${thread}/messages/m1`)));
  await assertFails(getDoc(doc(await as(other.uid), `assistantThreads/${thread}/messages/m1`)));
  await assertFails(getDoc(doc(await as(B.admin.uid), `assistantThreads/${thread}/messages/m1`)));
});

test("history: an artist's entries for its admins, a person's for that person, the shared directory's for any admin", async () => {
  const group = async (uid: string, ...w: [string, "==", unknown][]) => getDocs(query(collectionGroup(await as(uid), "history"), ...w.map((x) => where(...x))));
  // Artist scope
  await assertSucceeds(group(A.admin.uid, ["artistId", "==", A.artistId]));
  assert.ok((await group(A.admin.uid, ["artistId", "==", A.artistId])).size > 0, "A's admin sees A's history");
  await assertFails(group(B.admin.uid, ["artistId", "==", A.artistId]));
  await assertFails(group(A.member.uid, ["artistId", "==", A.artistId]));
  await assertFails(group(both.uid, ["artistId", "==", A.artistId])); // a member of A, admin of B
  await assertSucceeds(group(both.uid, ["artistId", "==", B.artistId]));
  // Shared scope: the Activity page's second listener.
  await assertSucceeds(group(B.admin.uid, ["artistId", "==", null], ["shared", "==", true]));
  assert.ok((await group(B.admin.uid, ["artistId", "==", null], ["shared", "==", true])).size > 0, "the venue's entry is shared");
  await assertFails(group(A.member.uid, ["artistId", "==", null], ["shared", "==", true]));
  // Person scope: one's own users-doc history.
  const [mine] = (await firestore().collection(`users/${A.member.uid}/history`).get()).docs;
  assert.ok(mine, "the member's users doc has History");
  await assertSucceeds(getDoc(doc(await as(A.member.uid), mine.ref.path)));
  await assertSucceeds(group(A.member.uid, ["ownerUid", "==", A.member.uid]));
  await assertFails(getDoc(doc(await as(A.admin.uid), mine.ref.path)));
  await assertFails(group(A.admin.uid, ["ownerUid", "==", A.member.uid]));
  // Unfiltered never.
  await assertFails(getDocs(collectionGroup(await as(A.admin.uid), "history")));
  // Each artist's record entries: A's show entry for A's admin only.
  const [showEntry] = (await firestore().collection(at(A, `shows/${A.refs.shows}/history`)).get()).docs;
  await assertSucceeds(getDoc(doc(await as(A.admin.uid), showEntry.ref.path)));
  await assertFails(getDoc(doc(await as(B.admin.uid), showEntry.ref.path)));
});

test("people: an admin lists their artist's users by artistIds, gets a person in both artists, never one only in B", async () => {
  const c = await as(A.admin.uid);
  await assertSucceeds(getDocs(query(collection(c, "users"), where("artistIds", "array-contains", A.artistId))));
  await assertFails(getDocs(query(collection(c, "users"), where("artistIds", "array-contains", B.artistId))));
  await assertFails(getDocs(collection(c, "users")));
  await assertSucceeds(getDoc(doc(c, "users", both.uid)));
  await assertFails(getDoc(doc(c, "users", B.admin.uid)));
  // A member reads only their own.
  const m = await as(A.member.uid);
  await assertSucceeds(getDoc(doc(m, "users", A.member.uid)));
  await assertFails(getDoc(doc(m, "users", A.admin.uid)));
  await assertFails(getDocs(query(collection(m, "users"), where("artistIds", "array-contains", A.artistId))));
});

test("a member of two artists with a musician in each reads only their own payouts and availability, in each", async () => {
  const ctxA = { uid: A.admin.uid, role: "admin" as const, via: "app" as const, runId: "r-two", artistId: A.artistId };
  const mA = (await db.create(ctxA, "musicians", { name: "Two Ways", instruments: ["fiddle"], active: true })).id;
  const mB = (await db.create({ ...ctxA, uid: B.admin.uid, artistId: B.artistId }, "musicians", { name: "Two Ways", instruments: ["fiddle"], active: true })).id;
  const two = await makeUser("two@ab.example", "member", { artists: [{ artistId: A.artistId, role: "member", musicianId: mA }, { artistId: B.artistId, role: "member", musicianId: mB }] });
  const fs = firestore();
  const live = { deletedAt: null };
  const pay = (artistId: string, to: Record<string, string>) => ({ ...live, artistId, to: { name: "Two Ways", ...to }, kind: "pay", amount: 100, projectId: "p" });
  const ask = (artistId: string, ids: string[]) => ({ ...live, artistId, date: "2027-05-01", label: "x", askedMusicianIds: ids, responses: {}, linkTokens: {} });
  // Each doc in its artist ("<artist> <logical path>"), stored where this run's layout puts it.
  const where_ = new Map<string, string>();
  const put = async (artistId: string, p: string, data: Record<string, unknown>) => { where_.set(p, at(artistId, p)); await fs.doc(at(artistId, p)).set(data); };
  await put(A.artistId, "payouts/two-a", pay(A.artistId, { musicianId: mA }));
  await put(B.artistId, "payouts/two-b", pay(B.artistId, { musicianId: mB }));
  await put(B.artistId, "payouts/two-a-in-b", pay(B.artistId, { musicianId: mA })); // A's musician id named in B: not theirs there
  await put(B.artistId, "payouts/two-user-b", pay(B.artistId, { userId: two.uid }));
  await put(A.artistId, "payouts/other-a", pay(A.artistId, { musicianId: A.refs.musicianId }));
  await put(A.artistId, "availability/two-a", ask(A.artistId, [mA]));
  await put(B.artistId, "availability/two-b", ask(B.artistId, [mB]));
  await put(B.artistId, "availability/two-a-in-b", ask(B.artistId, [mA]));
  await put(A.artistId, "availability/other-a", ask(A.artistId, [A.refs.musicianId]));

  const c = await as(two.uid);
  for (const p of ["payouts/two-a", "payouts/two-b", "payouts/two-user-b", "availability/two-a", "availability/two-b"]) {
    await assertSucceeds(getDoc(doc(c, where_.get(p)!))).catch(() => assert.fail(`can't read own ${p}`));
  }
  for (const p of ["payouts/two-a-in-b", "payouts/other-a", "availability/two-a-in-b", "availability/other-a"]) {
    await assertFails(getDoc(doc(c, where_.get(p)!))).catch(() => assert.fail(`can read ${p}`));
  }
  // The lists members send.
  const q = (kind: string, artistId: string, ...w: [string, "==" | "array-contains", string][]) =>
    getDocs(query(collection(c, at(artistId, kind)), where("artistId", "==", artistId), ...w.map((x) => where(...x)), where("deletedAt", "==", null)));
  for (const [artistId, m] of [[A.artistId, mA], [B.artistId, mB]]) {
    assert.ok((await assertSucceeds(q("payouts", artistId, ["to.musicianId", "==", m]))).size >= 1);
    assert.ok((await assertSucceeds(q("availability", artistId, ["askedMusicianIds", "array-contains", m]))).size >= 1);
    await assertSucceeds(q("payouts", artistId, ["to.userId", "==", two.uid]));
    await assertSucceeds(q("expenses", artistId, ["userId", "==", two.uid]));
  }
  await assertFails(q("payouts", B.artistId, ["to.musicianId", "==", mA]));
  await assertFails(q("availability", B.artistId, ["askedMusicianIds", "array-contains", mA]));
  await assertFails(q("expenses", A.artistId, ["userId", "==", A.admin.uid]));
  await assertFails(getDocs(query(collection(c, at(A, "payouts")), where("artistId", "==", A.artistId), where("deletedAt", "==", null))));
});

test("sub-collections follow their own record's artist", async () => {
  // A member of A, with the band's comment, entry and their audience/visibility filters.
  const m = await as(A.member.uid);
  const showComments = at(A, `shows/${A.refs.shows}/comments`);
  await firestore().doc(`${showComments}/band`).set({ deletedAt: null, artistId: A.artistId, audience: "band", body: "Soundcheck at 5" });
  await assertSucceeds(getDocs(query(collection(m, showComments), where("artistId", "==", A.artistId), where("audience", "==", "band"), where("deletedAt", "==", null))));
  await assertFails(getDocs(query(collection(m, showComments), where("artistId", "==", A.artistId), where("deletedAt", "==", null))));
  await assertFails(getDocs(query(collection(await as(B.admin.uid), showComments), where("artistId", "==", A.artistId))));
  // Tracks across releases (the song page's collection-group query) for A's admin only.
  await assertSucceeds(getDocs(query(collectionGroup(await as(A.admin.uid), "tracks"), where("artistId", "==", A.artistId), where("songId", "==", A.refs.songs))));
  await assertFails(getDocs(query(collectionGroup(await as(B.admin.uid), "tracks"), where("artistId", "==", A.artistId), where("songId", "==", A.refs.songs))));
  for (const kind of SUB_KINDS) assert.ok(A.records[kind].path.includes("/"), `${kind} is a sub-collection`);
});

test("no client writes, for anyone", async () => {
  for (const uid of [A.admin.uid, A.member.uid, both.uid]) {
    const c = await as(uid);
    await assertFails(setDoc(doc(c, "shows", "new"), { artistId: A.artistId }));
    await assertFails(setDoc(doc(c, at(A, "shows"), "new"), { artistId: A.artistId }));
    await assertFails(setDoc(doc(c, "users", uid), { name: "x" }));
  }
  assert.ok(await db.get(SYS, "artists", A.artistId));
});
