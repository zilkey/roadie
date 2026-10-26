/**
 * The "waiting" pitch status was merged into "pitched" (both meant: we sent it, no answer yet):
 *   tsx scripts/migrate-pitch-waiting.ts [--dry-run] [--yes]
 * Every pitch still in "waiting" moves to "pitched". Nothing else changes: lastContactAt stays (so the two-week clock
 * is not restarted) and no timeline entry is added; old entries that say "Waiting" stay as history. Live docs are written
 * through the normal writer (history + rev, via "import"); soft-deleted pitches are fixed in place. Safe to run again.
 * Against real Firestore (no emulator host) it needs --yes.
 */
import type { Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { db } from "@/server/db";

export interface MigratePitchWaitingResult {
  migrated: { id: string; target: string }[];
}

export async function migratePitchWaiting(fs: Firestore, opts: { dryRun?: boolean } = {}): Promise<MigratePitchWaitingResult> {
  const ctx = importCtx("migrate-pitch-waiting");
  const docs = (await fs.collection("pitches").where("status", "==", "waiting").get()).docs;
  const out: MigratePitchWaitingResult = { migrated: [] };
  for (const d of docs) {
    const p = d.data() as { target?: { name?: string }; deletedAt?: unknown };
    out.migrated.push({ id: d.id, target: p.target?.name ?? "" });
    if (opts.dryRun) continue;
    if (p.deletedAt) await d.ref.update({ status: "pitched" });
    else await db.update(ctx, "pitches", d.id, { status: "pitched" });
  }
  return out;
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await migratePitchWaiting(firestore(), { dryRun: flag("dry-run") });
  for (const m of r.migrated) console.log(`${flag("dry-run") ? "Would move" : "Moved"} pitch ${m.id} (${m.target}) from Waiting to Pitched`);
  console.log(`${r.migrated.length} pitch(es) migrated${flag("dry-run") ? " (dry run, nothing written)" : ""}.`);
}

if (process.argv[1]?.endsWith("migrate-pitch-waiting.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
