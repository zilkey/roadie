/**
 * Move the old top-level `history/{id}` documents under the records they describe:
 *   tsx scripts/migrate-history.ts [--dry-run] [--yes]
 * Each entry becomes `{entity.kind}/{entity.id}/history/{rev}` (rev = its docRev, zero-padded to 6 digits). Entries from before
 * `docRev` existed become `000000-{createdAt ms}-{old id}`, which sorts before every real rev and in time order.
 * Safe to run again: ids are derived from the entry itself, each move is one atomic batch (write the new, delete the old),
 * so a half-finished run is simply finished by the next one. Against real Firestore (no emulator host) it needs --yes.
 */
import type { Firestore, Timestamp } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { revId } from "@/server/db";

export interface MigrateResult { moved: number; collisions: number; remaining: number }

const ms = (v: unknown) => (v as Timestamp | undefined)?.toMillis?.() ?? 0;

/** The id an old entry gets under its record. */
export function newHistoryId(data: Record<string, unknown>, oldId: string): string {
  return typeof data.docRev === "number" ? revId(data.docRev) : `000000-${String(ms(data.createdAt)).padStart(13, "0")}-${oldId}`;
}

export async function migrateHistory(fs: Firestore, opts: { dryRun?: boolean } = {}): Promise<MigrateResult> {
  const snap = await fs.collection("history").get();
  const taken = new Set<string>();
  const plan: { from: FirebaseFirestore.DocumentReference; to: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];
  let collisions = 0;
  for (const d of snap.docs) {
    const data = d.data();
    const kind = data.entity?.kind as string | undefined, rid = data.entity?.id as string | undefined;
    if (!kind || !rid) throw new Error(`history/${d.id} has no entity: refusing to guess where it belongs`);
    const base = fs.collection(`${kind}/${rid}/history`);
    let tid = newHistoryId(data, d.id);
    const there = await base.doc(tid).get();
    if (taken.has(`${base.path}/${tid}`) || (there.exists && ms(there.data()?.createdAt) !== ms(data.createdAt))) {
      // Two different entries claim one rev (or another entry already sits there): keep both.
      tid = `${tid}-${d.id}`;
      collisions++;
    }
    taken.add(`${base.path}/${tid}`);
    plan.push({ from: d.ref, to: base.doc(tid), data: { ...data, id: tid } });
  }
  if (!opts.dryRun) {
    for (let i = 0; i < plan.length; i += 200) {
      const batch = fs.batch();
      for (const p of plan.slice(i, i + 200)) { batch.set(p.to, p.data); batch.delete(p.from); }
      await batch.commit();
    }
  }
  return { moved: plan.length, collisions, remaining: opts.dryRun ? plan.length : (await fs.collection("history").limit(1).get()).size };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await migrateHistory(firestore(), { dryRun: flag("dry-run") });
  console.log(`${flag("dry-run") ? "Would move" : "Moved"} ${r.moved} history entries under their records (${r.collisions} id collisions kept apart).`);
}

if (process.argv[1]?.endsWith("migrate-history.ts")) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
