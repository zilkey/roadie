/**
 * Empty a project: back up everything, then delete every Firestore document and every Auth user.
 *   npm run wipe -- --dry-run                           (emulator, reports only)
 *   npm run wipe -- --yes                               (emulator, deletes)
 *   GCLOUD_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS=./key.json \
 *     tsx scripts/wipe.ts --yes --project=roadie-prod-iab   (real Firestore)
 *
 * `reset()` in scripts/seed.ts only talks to the emulator's REST endpoint, which real Firestore does not have; this
 * script works against both, so the production wipe is not done by hand in the console.
 *
 * Always backs up before deleting anything, into backups/<local date>T<local time>/ (scripts/backup.ts). A backup
 * error stops the run with nothing deleted. A dry run deletes nothing, so it does not write a backup either: it
 * reports what would go.
 *
 * The folder is stamped in LOCAL time, to the second, unlike `npm run backup`'s plain UTC date. Both matter for a
 * wipe: a production wipe happens at night, when a UTC date is already tomorrow and the folder would be filed under
 * a day that has not started here yet; and two wipes in one sitting (wipe, seed, "wrong data", wipe again) would
 * otherwise write the same folder, the second backup overwriting the only copy of what the first one saved.
 *
 * The walk is dumpAll's walk, so what is deleted is what was backed up -- with one exception: `mutations` and
 * `unsubmittedDrafts` are left out of backups (bookkeeping and personal scratch that expire on their own) but are
 * still deleted, because a draft surviving the wipe would reopen a stale create form against records that are gone.
 * They are reported separately so the two sets are never confused.
 *
 * Guard rails, because this is the one step that cannot be undone:
 *   - no flags at all behaves as --dry-run, so a bare `tsx scripts/wipe.ts` can never delete;
 *   - real Firestore (no emulator host) needs --yes AND --project=<id> matching GCLOUD_PROJECT exactly;
 *   - no GCLOUD_PROJECT and no emulator host at all: refused, so it can never guess at a target;
 *   - the target is printed on the first line of every run, dry runs included.
 *
 * It takes everything, jeff@zilkey.com included: a surviving users/{uid} doc would point at an artist id that no
 * longer exists, which looks like a broken sign-in rather than a leftover. The seed script puts back what should be there.
 */
import { type Firestore } from "firebase-admin/firestore";
import { adminAuth, firestore } from "@/server/admin";
import { NOT_BACKED_UP, walkDocs } from "@/server/backup";
import { backup } from "./backup";

export interface WipeResult {
  /** Documents deleted (or, on a dry run, that would be deleted) per top-level collection, sub-collection docs counted under their parent. Includes the NOT_BACKED_UP collections. */
  collections: Record<string, number>;
  /** Total documents across every collection. */
  documents: number;
  /** Auth users deleted (or that would be). */
  authUsers: number;
  /** Where the backup was written (backups/<local date>T<local time>); null on a dry run (nothing is deleted, so nothing is backed up). */
  backupDir: string | null;
  dryRun: boolean;
}

/** Collections the backup leaves out (src/server/backup.ts) but the wipe still clears. */
export { NOT_BACKED_UP };

/** Every document path in the project, sub-collections included: dumpAll's walk, so what is deleted is what was backed up. */
async function allPaths(fs: Firestore): Promise<Record<string, string[]>> {
  const docs = await walkDocs(fs);
  return Object.fromEntries(Object.entries(docs).map(([top, ds]) => [top, ds.map((d) => d.ref.path)]));
}

/** List every Auth user, paged. */
async function allAuthUids(): Promise<string[]> {
  const uids: string[] = [];
  let page: string | undefined;
  do {
    const res = await adminAuth().listUsers(1000, page);
    uids.push(...res.users.map((u) => u.uid));
    page = res.pageToken;
  } while (page);
  return uids;
}

/**
 * Backup folder name: the local date and time to the second, e.g. 2026-10-24T21-07-03. Local because a wipe is run
 * at night and a UTC date would be tomorrow's; to the second so a second wipe in the same sitting cannot overwrite
 * the first one's backup. Colons are not in it: they are awkward in paths.
 */
export function localStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export async function wipe(fs: Firestore, opts: { dryRun?: boolean; outRoot?: string; date?: string } = {}): Promise<WipeResult> {
  const dryRun = !!opts.dryRun;
  const paths = await allPaths(fs);
  const uids = await allAuthUids();
  const collections = Object.fromEntries(Object.entries(paths).map(([col, p]) => [col, p.length]));
  const documents = Object.values(paths).reduce((n, p) => n + p.length, 0);
  if (dryRun) return { collections, documents, authUsers: uids.length, backupDir: null, dryRun };

  // Back up before the first delete. Any error here throws, with nothing deleted.
  const { dir } = await backup(opts.outRoot ?? "backups", opts.date ?? localStamp());

  let batch = fs.batch(), pending = 0;
  for (const path of Object.values(paths).flat()) {
    batch.delete(fs.doc(path));
    if (++pending === 400) { await batch.commit(); batch = fs.batch(); pending = 0; }
  }
  if (pending) await batch.commit();

  for (let i = 0; i < uids.length; i += 1000) await adminAuth().deleteUsers(uids.slice(i, i + 1000));

  return { collections, documents, authUsers: uids.length, backupDir: dir, dryRun };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(`--${n}=`.length);
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  const project = process.env.GCLOUD_PROJECT;

  if (!project && !emulator) {
    throw new Error("No target: set GCLOUD_PROJECT (real Firestore) or FIRESTORE_EMULATOR_HOST (emulator). Refusing to guess.");
  }
  console.log(`Target: ${project ?? "demo-band-tracker"} (${emulator ? `emulator at ${emulator}` : "REAL Firestore"})`);

  // No flag at all is a dry run: a bare `tsx scripts/wipe.ts` can never delete.
  const dryRun = flag("dry-run") || !flag("yes");
  if (!dryRun && !emulator) {
    const named = arg("project");
    if (!named) throw new Error(`Wiping REAL Firestore also needs --project=${project} (typing the project id is the confirmation).`);
    if (named !== project) throw new Error(`--project=${named} does not match GCLOUD_PROJECT=${project}. Nothing deleted.`);
  }

  const r = await wipe(firestore(), { dryRun });
  const verb = dryRun ? "Would delete" : "Deleted";
  console.log(`${verb} ${r.documents} document(s) in ${Object.keys(r.collections).length} collection(s):`, r.collections);
  const extra = Object.keys(r.collections).filter((c) => NOT_BACKED_UP.has(c));
  if (extra.length) console.log(`  (${extra.join(", ")} are cleared too but are not in the backup: bookkeeping and personal scratch.)`);
  console.log(`${verb} ${r.authUsers} Auth user(s).`);
  if (r.backupDir) console.log(`Backed up to ${r.backupDir} before deleting.`);
  if (dryRun) console.log("(dry run, nothing deleted; re-run with --yes to delete)");
}

if (process.argv[1]?.endsWith("wipe.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
