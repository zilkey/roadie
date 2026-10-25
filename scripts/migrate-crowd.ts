/**
 * A show's crowd estimate was nested in the deal's rating; it is its own field now, beside paidAttendance:
 *   tsx scripts/migrate-crowd.ts [--dry-run] [--yes]
 * For every showDeal with a `rating.crowd`: the number is copied to the top-level `crowd` and dropped from the rating.
 * A deal that already has a top-level `crowd` keeps it (the nested one is still dropped, and a disagreement is reported).
 * A rating left with nothing in it is removed; the stars and notes are untouched otherwise.
 * Live docs go through the normal writer (history + rev, via "import"), so Admin → History can undo the run;
 * soft-deleted deals are fixed in place. Safe to run again: it only touches deals that still have a nested crowd.
 * Against real Firestore (no emulator host) it needs --yes.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { db } from "@/server/db";

export interface MigrateCrowdResult {
  runId: string;
  moved: { id: string; crowd: number; ratingLeft: boolean }[];
  kept: { id: string; had: number; nested: number }[];
}

export async function migrateCrowd(fs: Firestore, opts: { dryRun?: boolean } = {}): Promise<MigrateCrowdResult> {
  const ctx = importCtx("migrate-crowd");
  const deals = (await fs.collection("showDeals").get()).docs.map((d) => ({ id: d.id, ...d.data() }) as {
    id: string; crowd?: unknown; rating?: Record<string, unknown>; deletedAt?: unknown;
  });
  const out: MigrateCrowdResult = { runId: ctx.runId, moved: [], kept: [] };
  for (const d of deals) {
    const nested = d.rating?.crowd;
    if (typeof nested !== "number") continue;
    const { crowd: _drop, ...rest } = d.rating!;
    // An empty rating is no rating: don't leave `{}` behind on the deal.
    const rating = Object.keys(rest).length ? rest : undefined;
    const patch: Record<string, unknown> = { rating: rating ?? null };
    if (typeof d.crowd === "number") {
      out.kept.push({ id: d.id, had: d.crowd, nested });
    } else {
      out.moved.push({ id: d.id, crowd: nested, ratingLeft: !!rating });
      patch.crowd = nested;
    }
    if (opts.dryRun) continue;
    if (d.deletedAt) await fs.collection("showDeals").doc(d.id).update({ ...patch, rating: rating ?? FieldValue.delete() });
    else await db.update(ctx, "showDeals", d.id, patch);
  }
  return out;
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await migrateCrowd(firestore(), { dryRun: flag("dry-run") });
  const verb = flag("dry-run") ? "Would move" : "Moved";
  for (const m of r.moved) console.log(`${verb} deal ${m.id}: crowd ${m.crowd} out of the rating${m.ratingLeft ? "" : " (rating was only a crowd, removed)"}`);
  for (const k of r.kept) console.log(`Deal ${k.id} already has crowd ${k.had}: nested ${k.nested} dropped${k.had === k.nested ? "" : " (they disagree — the top-level one wins)"}`);
  console.log(`${r.moved.length} crowd estimate(s) moved, ${r.kept.length} already set${flag("dry-run") ? " (dry run, nothing written)" : ""}.`);
}

if (process.argv[1]?.endsWith("migrate-crowd.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
