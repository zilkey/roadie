/**
 * Albums became Releases (2026-10-29): the collection, the field names and the project kind were all renamed in code.
 *   tsx scripts/migrate-releases.ts [--dry-run] [--yes]
 * Moves whatever the old names still hold:
 *   - albums/{id} (and its albums/{id}/tracks) is copied to releases/{id} (and releases/{id}/tracks), then the old docs are deleted;
 *   - files.albumId -> releaseId and albumTrackId -> releaseTrackId (files, expenses, income);
 *   - projects with kind "album" become kind "release";
 *   - userPrefs hiddenSections / order entries "albums" become "releases".
 * Raw writes (a rename, not a change anyone made), so no history entries. Safe to run again: it only finds the old names.
 * Against real Firestore (no emulator host) it needs --yes.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";

export interface MigrateReleasesResult { releases: number; tracks: number; fields: number; projects: number; prefs: number }

export async function migrateReleases(fs: Firestore, opts: { dryRun?: boolean } = {}): Promise<MigrateReleasesResult> {
  const out: MigrateReleasesResult = { releases: 0, tracks: 0, fields: 0, projects: 0, prefs: 0 };
  const write = async (f: () => Promise<unknown>) => { if (!opts.dryRun) await f(); };

  for (const a of (await fs.collection("albums").get()).docs) {
    out.releases++;
    const tracks = await a.ref.collection("tracks").get();
    out.tracks += tracks.size;
    await write(async () => {
      const batch = fs.batch();
      const to = fs.collection("releases").doc(a.id);
      batch.set(to, a.data());
      for (const t of tracks.docs) { batch.set(to.collection("tracks").doc(t.id), t.data()); batch.delete(t.ref); }
      batch.delete(a.ref);
      await batch.commit();
    });
  }

  for (const [col, from, to] of [["files", "albumId", "releaseId"], ["files", "albumTrackId", "releaseTrackId"], ["expenses", "albumTrackId", "releaseTrackId"], ["income", "albumTrackId", "releaseTrackId"]] as const) {
    for (const d of (await fs.collection(col).orderBy(from).get()).docs) {
      out.fields++;
      await write(() => d.ref.update({ [to]: d.get(from), [from]: FieldValue.delete() }));
    }
  }

  for (const p of (await fs.collection("projects").where("kind", "==", "album").get()).docs) {
    out.projects++;
    await write(() => p.ref.update({ kind: "release" }));
  }

  for (const u of (await fs.collection("userPrefs").get()).docs) {
    const swap = (v: unknown) => (Array.isArray(v) ? v.map((s) => (s === "albums" ? "releases" : s)) : v);
    const patch: Record<string, unknown> = {};
    for (const k of ["hiddenSections", "order"]) {
      const v = u.get(k);
      if (Array.isArray(v) && v.includes("albums")) patch[k] = swap(v);
    }
    if (!Object.keys(patch).length) continue;
    out.prefs++;
    await write(() => u.ref.update(patch));
  }
  return out;
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await migrateReleases(firestore(), { dryRun: flag("dry-run") });
  const verb = flag("dry-run") ? "Would move" : "Moved";
  console.log(`${verb} ${r.releases} album(s) with ${r.tracks} track(s) to releases, renamed ${r.fields} albumId/albumTrackId field(s), ${r.projects} project kind(s), ${r.prefs} menu pref(s)${flag("dry-run") ? " (dry run, nothing written)" : ""}.`);
}

if (process.argv[1]?.endsWith("migrate-releases.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
