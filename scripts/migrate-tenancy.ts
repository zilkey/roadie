/**
 * Tenancy phase 3: give every existing artist record and History entry its scope (multi-tenancy plan, "Phase 3. Backfill prod").
 *   npm run migrate:tenancy -- --artist <id>                    (dry run: reports what it would change, changes nothing)
 *   npm run migrate:tenancy -- --artist <id> --apply            (does it; refused unless the run finds 0 orphans and 0 conflicts)
 *   npm run migrate:tenancy -- --artist <id> --out report.md    (also writes the report as Markdown)
 *   npm run migrate:tenancy -- --artist <id> --undo-snapshots [--apply]
 *       (rollback helper: after `npm run restore` brings back the old-id statSnapshots, delete their artist-prefixed copies)
 * Against the emulator, set FIRESTORE_EMULATOR_HOST; against prod, GCLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS. It refuses
 * to guess a target.
 *
 * Each record's artist, in this order (pre-approved in the plan):
 *   1. its own `artistId`, when it has one (checked against its parent's);
 *   2. its parent's: the doc it lives under (comments, activity, entries, tracks), the show it is keyed by (showDeals, setlists), or
 *      the record a field names (showId, pitchId, tourId, releaseId, songId, projectId, rehearsalId);
 *   3. the single artist of its `ownerUid` (assistantThreads);
 *   4. the single artist of the user who created it (`createdBy`);
 *   5. when `createdBy` is not a user (bootstrap, import, migrate-*, seed, stats-pull, link:<musicianId>, public:fans…): `--artist`;
 *   6. when the creator is in several artists and one is `--artist`: `--artist`;
 *   7. otherwise an orphan.
 * A conflict is a record whose parent's artist differs from its own `artistId`, or from its creator's single artist, or whose
 * parents disagree.
 *
 * Writes are stamp-only raw updates (no `rev`, `updatedAt`, `updatedBy` or History change, so "last edited" stays), each with the
 * doc's update time as a precondition, so a record someone changed after the read is left for the next run:
 *   - artist records get `artistId`;
 *   - History entries get their record's scope (D4): `artistId` for artist records (and the artist doc), `artistId: null` +
 *     `ownerUid` for a person's records, `artistId: null` + `shared: true` for shared ones;
 *   - users get `artistIds`, and the membership in their musician's artist gets `musicianId`;
 *   - old-id statSnapshots (`{source}_{date}`) are copied, with their History, to `{artistId}_{source}_{date}` and the old ones
 *     deleted.
 */
import fs from "node:fs";
import { FieldValue, type DocumentReference, type DocumentSnapshot, type Firestore, type QueryDocumentSnapshot, type WriteBatch } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { kindOf } from "@/schema";
import { OWNERS, PARENTS, ownerOf } from "@/schema/owners";
import { artistIdsOf, type Membership } from "@/schema/users";
import { snapshotId } from "@/server/commands/stats";

/** Fields that name an artist record: the record they point at is a parent (step 2). */
export const REF_FIELDS: Record<string, string> = {
  showId: "shows", pitchId: "pitches", tourId: "tours", releaseId: "releases", songId: "songs", projectId: "projects", rehearsalId: "rehearsals",
};
const ARTIST_KINDS = Object.keys(OWNERS).filter((k) => ownerOf(k) === "artist");

export type Via = "own" | "parent" | "ownerUid" | "createdBy" | "notAUser" | "several";
export interface Orphan { path: string; reason: string }
export interface Conflict { path: string; reason: string }
export interface KindCount {
  /** Records of this kind in each artist (stamped already or about to be). */
  byArtist: Record<string, number>;
  /** Of those, the ones this run stamps (or moves, for old-id statSnapshots), per artist. */
  toStamp: Record<string, number>;
  /** How the stamped ones found their artist. */
  via: Partial<Record<Via, number>>;
}
export interface Report {
  target: string; artist: string; apply: boolean;
  kinds: Record<string, KindCount>;
  history: { total: number; already: number; toStamp: number; byScope: Record<string, number>; skipped: Record<string, number> };
  users: { total: number; toChange: number; memberships: number };
  snapshots: { toMove: number };
  orphans: Orphan[];
  conflicts: Conflict[];
  /** Everything this run changes (or would): records + History entries + users + snapshot moves. 0 on a clean second run. */
  left: number;
  /** Apply only: writes refused because the doc changed after the read (run again). */
  failed: { path: string; error: string }[];
}

interface Rec { ref: DocumentReference; kind: string; data: Record<string, unknown>; updateTime: FirebaseFirestore.Timestamp }
type Resolved = { artistId: string; via: Via } | { orphan: string } | null;

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const inc = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] ?? 0) + n; };

/** Every doc of an artist kind: top-level, or a sub-collection (collection group, under the parent kinds it belongs to). */
async function loadKind(fs: Firestore, kind: string): Promise<Rec[]> {
  const p = PARENTS[kind];
  const snap = p && !p.keyedById ? await fs.collectionGroup(kind).get() : await fs.collection(kind).get();
  return snap.docs
    .filter((d) => !(p && !p.keyedById) || p.kinds.includes(d.ref.parent.parent?.parent.id ?? ""))
    .map((d) => ({ ref: d.ref, kind, data: d.data(), updateTime: d.updateTime }));
}

export async function migrateTenancy(opts: { artist: string; apply: boolean; fs?: Firestore; log?: (s: string) => void }): Promise<Report> {
  const db = opts.fs ?? firestore();
  const log = opts.log ?? (() => undefined);
  const target = process.env.FIRESTORE_EMULATOR_HOST ? `emulator ${process.env.FIRESTORE_EMULATOR_HOST} (${process.env.GCLOUD_PROJECT ?? "demo"})` : `${process.env.GCLOUD_PROJECT}`;
  const art = await db.collection("artists").doc(opts.artist).get();
  if (!art.exists) throw new Error(`--artist ${opts.artist}: no such artist`);

  const report: Report = {
    target, artist: opts.artist, apply: opts.apply, kinds: {},
    history: { total: 0, already: 0, toStamp: 0, byScope: {}, skipped: {} },
    users: { total: 0, toChange: 0, memberships: 0 }, snapshots: { toMove: 0 }, orphans: [], conflicts: [], left: 0, failed: [],
  };

  // --- who is in which artist ---
  const usersSnap = await db.collection("users").get();
  const artistsOf = new Map<string, string[]>();
  for (const u of usersSnap.docs) artistsOf.set(u.id, artistIdsOf(u.data()));

  // --- every artist record, by path ---
  const recs = new Map<string, Rec>();
  for (const kind of ARTIST_KINDS) for (const r of await loadKind(db, kind)) recs.set(r.ref.path, r);
  log(`read ${recs.size} artist records, ${usersSnap.size} users`);

  /** The paths of a record's parents (step 2). */
  const parentsOf = (r: Rec): string[] => {
    const out: string[] = [];
    const p = PARENTS[r.kind];
    if (p && !p.keyedById) { const parent = r.ref.parent.parent; if (parent) out.push(parent.path); }
    if (p?.keyedById) for (const k of p.kinds) out.push(`${k}/${r.ref.id}`);
    for (const [f, k] of Object.entries(REF_FIELDS)) {
      const id = str(r.data[f]);
      if (id && k !== r.kind) out.push(`${k}/${id}`);
    }
    return out;
  };
  /** The single artist of a user, `--artist` for one of several, or why not. `undefined` when `uid` isn't a user. */
  const userArtist = (uid: string | undefined): { artistId?: string; several?: true; none?: true } | undefined => {
    if (!uid) return undefined;
    const as = artistsOf.get(uid);
    if (!as) return undefined;
    if (as.length === 1) return { artistId: as[0] };
    if (!as.length) return { none: true };
    return as.includes(opts.artist) ? { artistId: opts.artist, several: true } : { several: true };
  };

  const memo = new Map<string, Resolved | "busy">();
  const resolve = (path: string): Resolved => {
    const m = memo.get(path);
    if (m === "busy") return null; // a cycle: no answer from this side
    if (m !== undefined) return m;
    const r = recs.get(path);
    if (!r) return null;
    memo.set(path, "busy");
    const out = decide(r);
    memo.set(path, out);
    return out;
  };
  const decide = (r: Rec): Resolved => {
    const parentArtists = [...new Set(parentsOf(r).map(resolve).flatMap((x) => (x && "artistId" in x ? [x.artistId] : [])))];
    const own = str(r.data.artistId);
    if (parentArtists.length > 1) report.conflicts.push({ path: r.ref.path, reason: `its parents are in different artists (${parentArtists.join(", ")})` });
    const parent = parentArtists.length === 1 ? parentArtists[0] : undefined;
    if (own) {
      if (parent && parent !== own) report.conflicts.push({ path: r.ref.path, reason: `its artistId is ${own} but its parent's is ${parent}` });
      return { artistId: own, via: "own" };
    }
    const creator = str(r.data.createdBy);
    const byCreator = userArtist(creator);
    if (parent) {
      if (byCreator?.artistId && !byCreator.several && byCreator.artistId !== parent) {
        report.conflicts.push({ path: r.ref.path, reason: `its parent is in ${parent} but its creator (${creator}) is only in ${byCreator.artistId}` });
      }
      return { artistId: parent, via: "parent" };
    }
    const byOwner = userArtist(str(r.data.ownerUid));
    if (byOwner?.artistId && !byOwner.several) return { artistId: byOwner.artistId, via: "ownerUid" };
    if (byCreator?.artistId && !byCreator.several) return { artistId: byCreator.artistId, via: "createdBy" };
    if (!byCreator) return { artistId: opts.artist, via: "notAUser" };
    if (byCreator.several && byCreator.artistId) return { artistId: byCreator.artistId, via: "several" };
    return { orphan: byCreator.none ? `its creator (${creator}) is in no artist` : `its creator (${creator}) is in several artists, none of them ${opts.artist}` };
  };

  // --- decide every record ---
  const stamps: { rec: Rec; artistId: string }[] = [];
  const moves: { rec: Rec; artistId: string; newId: string }[] = [];
  const resolvedArtist = new Map<string, string>();
  for (const r of recs.values()) {
    const res = resolve(r.ref.path);
    const kc = (report.kinds[r.kind] ??= { byArtist: {}, toStamp: {}, via: {} });
    if (!res) { report.orphans.push({ path: r.ref.path, reason: "no artist found" }); continue; }
    if ("orphan" in res) { report.orphans.push({ path: r.ref.path, reason: res.orphan }); continue; }
    resolvedArtist.set(r.ref.path, res.artistId);
    inc(kc.byArtist, res.artistId);
    const oldSnapshot = r.kind === "statSnapshots" && r.ref.id === snapshotId(undefined, r.data.source, r.data.date);
    if (oldSnapshot) {
      const newId = snapshotId(res.artistId, r.data.source, r.data.date);
      if (recs.has(`statSnapshots/${newId}`)) { report.conflicts.push({ path: r.ref.path, reason: `statSnapshots/${newId} already exists` }); continue; }
      moves.push({ rec: r, artistId: res.artistId, newId });
      inc(kc.toStamp, res.artistId); inc(kc.via, res.via);
      continue;
    }
    if (res.via === "own") continue;
    stamps.push({ rec: r, artistId: res.artistId });
    inc(kc.toStamp, res.artistId); inc(kc.via, res.via);
  }
  report.snapshots.toMove = moves.length;
  const moving = new Set(moves.map((m) => m.rec.ref.path));

  // --- History: every entry gets its record's scope ---
  const histSnap = await db.collectionGroup("history").get();
  const parentDocs = new Map<string, DocumentSnapshot | null>();
  const parentDoc = async (ref: DocumentReference) => {
    if (!parentDocs.has(ref.path)) { const s = await ref.get(); parentDocs.set(ref.path, s.exists ? s : null); }
    return parentDocs.get(ref.path) ?? null;
  };
  const histStamps: { h: QueryDocumentSnapshot; patch: Record<string, unknown> }[] = [];
  for (const h of histSnap.docs) {
    report.history.total++;
    const recRef = h.ref.parent.parent;
    if (!recRef) continue;
    if (moving.has(recRef.path)) continue; // copied with its snapshot
    const kind = kindOf(recRef.parent.path);
    const owner = ownerOf(kind);
    const d = h.data();
    let want: { artistId: string | null; ownerUid?: string; shared?: true } | undefined;
    if (owner === "artist") {
      const a = resolvedArtist.get(recRef.path) ?? str(d.artistId);
      if (!a) { report.orphans.push({ path: h.ref.path, reason: recs.has(recRef.path) ? "its record has no artist" : "its record is gone and the entry has no artistId" }); continue; }
      const had = str(d.artistId);
      if (had && had !== a) { report.conflicts.push({ path: h.ref.path, reason: `the entry says ${had} but its record is in ${a}` }); continue; }
      want = { artistId: a };
    } else if (owner === "artist-self") {
      want = { artistId: recRef.id };
    } else if (owner === "shared") {
      want = { artistId: null, shared: true };
    } else if (owner === "user") {
      const seg = recRef.path.split("/");
      let ownerUid: string | undefined;
      if (seg.length >= 4) ownerUid = seg[seg.length - 3];
      else if (kind === "users" || kind === "userPrefs") ownerUid = recRef.id;
      else { const p = await parentDoc(recRef); ownerUid = str(p?.get("uid")) ?? str(p?.get("createdBy")) ?? str(d.createdBy); }
      if (!ownerUid) { report.orphans.push({ path: h.ref.path, reason: "no owner found for a person's record" }); continue; }
      want = { artistId: null, ownerUid };
    } else {
      inc(report.history.skipped, kind); // server-only kinds: no browser reads them, so no scope
      continue;
    }
    const scopeName = want.ownerUid ? "ownerUid" : want.shared ? "shared" : "artistId";
    inc(report.history.byScope, scopeName);
    const patch: Record<string, unknown> = {};
    if (!("artistId" in d) || d.artistId !== want.artistId) patch.artistId = want.artistId;
    if (want.ownerUid ? d.ownerUid !== want.ownerUid : "ownerUid" in d) patch.ownerUid = want.ownerUid ?? FieldValue.delete();
    if (want.shared ? d.shared !== true : "shared" in d) patch.shared = want.shared ?? FieldValue.delete();
    if (!Object.keys(patch).length) { report.history.already++; continue; }
    histStamps.push({ h, patch });
  }
  report.history.toStamp = histStamps.length;

  // --- users: artistIds, and Membership.musicianId from users.musicianId ---
  const userPatches: { u: QueryDocumentSnapshot; patch: Record<string, unknown> }[] = [];
  for (const u of usersSnap.docs) {
    report.users.total++;
    const d = u.data();
    const patch: Record<string, unknown> = {};
    const ids = artistIdsOf(d);
    const had = Array.isArray(d.artistIds) ? (d.artistIds as string[]) : undefined;
    if (!had || had.length !== ids.length || had.some((x, i) => x !== ids[i])) patch.artistIds = ids;
    const mid = str(d.musicianId);
    const ms = Array.isArray(d.artists) ? (d.artists as Membership[]) : [];
    if (mid) {
      const ma = resolvedArtist.get(`musicians/${mid}`);
      if (!ma) report.conflicts.push({ path: u.ref.path, reason: `its musician ${mid} has no artist (or is gone)` });
      else if (!ms.some((m) => m.artistId === ma)) report.conflicts.push({ path: u.ref.path, reason: `its musician ${mid} is in ${ma}, where this person has no membership` });
      else if (ms.find((m) => m.artistId === ma)?.musicianId !== mid) {
        patch.artists = ms.map((m) => (m.artistId === ma ? { ...m, musicianId: mid } : m));
        report.users.memberships++;
      }
    }
    if (Object.keys(patch).length) userPatches.push({ u, patch });
  }
  report.users.toChange = userPatches.length;

  report.left = stamps.length + histStamps.length + userPatches.length + moves.length;
  if (!opts.apply) return report;
  if (report.orphans.length || report.conflicts.length) {
    throw new Error(`Refusing to apply: ${report.orphans.length} orphan(s) and ${report.conflicts.length} conflict(s). Fix them first (the dry run lists them).`);
  }

  // --- apply ---
  const bw = db.bulkWriter();
  bw.onWriteError((e) => { report.failed.push({ path: e.documentRef.path, error: e.message }); return false; });
  for (const s of stamps) void bw.update(s.rec.ref, { artistId: s.artistId }, { lastUpdateTime: s.rec.updateTime });
  for (const h of histStamps) void bw.update(h.h.ref, h.patch, { lastUpdateTime: h.h.updateTime });
  for (const u of userPatches) void bw.update(u.u.ref, u.patch, { lastUpdateTime: u.u.updateTime });
  await bw.close();
  log(`stamped ${stamps.length} records, ${histStamps.length} history entries, ${userPatches.length} users`);

  for (const m of moves) {
    const batch = db.batch();
    const to = db.collection("statSnapshots").doc(m.newId);
    batch.create(to, { ...m.rec.data, artistId: m.artistId });
    await copyHistory(db, m.rec.ref, to, { artistId: m.artistId }, batch);
    batch.delete(m.rec.ref, { lastUpdateTime: m.rec.updateTime });
    try { await batch.commit(); } catch (e) { report.failed.push({ path: m.rec.ref.path, error: e instanceof Error ? e.message : String(e) }); }
  }
  log(`moved ${moves.length} statSnapshots to artist-prefixed ids`);
  return report;
}

/** Copy a doc's History under `to` (entity.id and the scope set), deleting the old entries, in `batch`. */
async function copyHistory(db: Firestore, from: DocumentReference, to: DocumentReference, scope: Record<string, unknown>, batch: WriteBatch) {
  for (const h of (await from.collection("history").get()).docs) {
    const d = h.data();
    batch.set(to.collection("history").doc(h.id), { ...d, ...scope, entity: { ...(d.entity as object), id: to.id } });
    batch.delete(h.ref);
  }
}

/**
 * Rollback helper: delete artist-prefixed statSnapshots (and their History) whose old-id twin exists again with the same
 * `createdAt` (the copy keeps it), as after `npm run restore` of the pre-migration backup (restore doesn't delete docs the
 * backup lacks). Snapshots written fresh under the new ids, and another artist's snapshot of the same day, stay.
 */
export async function undoSnapshots(opts: { apply: boolean; fs?: Firestore }): Promise<{ paths: string[] }> {
  const db = opts.fs ?? firestore();
  const all = await db.collection("statSnapshots").get();
  const byId = new Map(all.docs.map((d) => [d.id, d]));
  const paths: string[] = [];
  const sameTime = (x: unknown, y: unknown) => !!x && !!y && typeof (x as { isEqual?: unknown }).isEqual === "function" && (x as FirebaseFirestore.Timestamp).isEqual(y as FirebaseFirestore.Timestamp);
  for (const d of all.docs) {
    const a = str(d.get("artistId"));
    const twin = byId.get(snapshotId(undefined, d.get("source"), d.get("date")));
    if (!a || d.id !== snapshotId(a, d.get("source"), d.get("date")) || !twin || !sameTime(twin.get("createdAt"), d.get("createdAt"))) continue;
    paths.push(d.ref.path);
    if (!opts.apply) continue;
    const batch = db.batch();
    for (const h of (await d.ref.collection("history").get()).docs) batch.delete(h.ref);
    batch.delete(d.ref);
    await batch.commit();
  }
  return { paths };
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

/** The report as Markdown (what the dry run prints and `--out` saves). */
export function formatReport(r: Report): string {
  const artists = [...new Set(Object.values(r.kinds).flatMap((k) => Object.keys(k.byArtist)))].sort();
  const lines = [
    `# migrate-tenancy ${r.apply ? "apply" : "dry run"}: ${r.target}, --artist ${r.artist}`, "",
    `**${r.left} to change**: ${sum(Object.fromEntries(Object.entries(r.kinds).map(([k, c]) => [k, sum(c.toStamp)])))} records (${r.snapshots.toMove} of them statSnapshot moves), ` +
      `${r.history.toStamp} History entries, ${r.users.toChange} users (${r.users.memberships} membership musicianIds). ` +
      `**${r.orphans.length} orphans, ${r.conflicts.length} conflicts.**`, "",
    "## Records per kind and artist", "",
    `| kind | ${artists.map((a) => `${a} (all)`).join(" | ")} | to stamp | via |`, `|---|${artists.map(() => "---:").join("|")}|---:|---|`,
    ...Object.entries(r.kinds).sort(([a], [b]) => a.localeCompare(b)).map(([k, c]) =>
      `| ${k} | ${artists.map((a) => c.byArtist[a] ?? 0).join(" | ")} | ${sum(c.toStamp)} | ${Object.entries(c.via).map(([v, n]) => `${v} ${n}`).join(", ")} |`),
    "", "## History",
    `${r.history.total} entries: ${r.history.already} already scoped, ${r.history.toStamp} to stamp. Scopes: ${Object.entries(r.history.byScope).map(([s, n]) => `${s} ${n}`).join(", ") || "none"}.` +
      (Object.keys(r.history.skipped).length ? ` Skipped (server-only kinds): ${Object.entries(r.history.skipped).map(([s, n]) => `${s} ${n}`).join(", ")}.` : ""),
    "", `## Users`, `${r.users.total} users, ${r.users.toChange} to change (${r.users.memberships} membership musicianIds).`,
    "", `## Orphans (${r.orphans.length})`, ...r.orphans.map((o) => `- ${o.path}: ${o.reason}`),
    "", `## Conflicts (${r.conflicts.length})`, ...r.conflicts.map((c) => `- ${c.path}: ${c.reason}`),
  ];
  if (r.apply) lines.push("", `## Failed writes (${r.failed.length})`, ...r.failed.map((f) => `- ${f.path}: ${f.error}`));
  return lines.join("\n") + "\n";
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const apply = argv.includes("--apply");
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  const project = process.env.GCLOUD_PROJECT;
  if (!project && !emulator) throw new Error("No target: set GCLOUD_PROJECT (real Firestore) or FIRESTORE_EMULATOR_HOST (emulator). Refusing to guess.");
  console.log(`Target: ${project ?? "demo-band-tracker"} (${emulator ? `emulator at ${emulator}` : "REAL Firestore"})${apply ? "" : ", dry run"}`);
  if (argv.includes("--undo-snapshots")) {
    const r = await undoSnapshots({ apply });
    console.log(`${apply ? "Deleted" : "Would delete"} ${r.paths.length} artist-prefixed statSnapshot(s):`);
    for (const p of r.paths) console.log(`  ${p}`);
    return;
  }
  const artist = arg("artist");
  if (!artist) throw new Error("--artist <id> is required (the real artist: records whose creator isn't a person land there)");
  const r = await migrateTenancy({ artist, apply, log: (s) => console.error(`  ${s}`) });
  const md = formatReport(r);
  console.log(md);
  const out = arg("out");
  if (out) fs.writeFileSync(out, md);
  if (!apply) console.log("(dry run, nothing changed; re-run with --apply)");
  if (apply && r.failed.length) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("migrate-tenancy.ts")) main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
