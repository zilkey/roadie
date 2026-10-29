/**
 * Gas used to be a travel expense. It is now its own category ("gas"); travel is flights, tolls and parking:
 *   npm run migrate:gas -- [--write] [--yes]   (--yes is required to write to real Firestore, i.e. without FIRESTORE_EMULATOR_HOST)
 * Finds every live expense with category "travel" that carries a `gas` estimate, or whose What for starts with "Gas" (the sheet
 * import, scripts/import-gas.ts, logged "Gas: rehearsal at David's (...)" as travel with no estimate), and sets its category to "gas". Nothing else
 * changes: amount, payBack and the estimate stay as they were. Dry run by default: it prints how many and a few examples and
 * writes nothing. --write does the rewrite through the normal writer (history + rev under one run id, so Admin -> History can
 * undo it). Soft-deleted expenses are skipped (the writer refuses deleted docs). Safe to run again: only travel expenses that are
 * gas are touched.
 */
import type { Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx, newRunId } from "@/server/ctx";
import { run } from "@/server/db";
import { formatCents } from "@/lib/money";

export interface MigrateGasCategoryResult {
  runId: string;
  dryRun: boolean;
  /** Live travel expenses that are gas (an estimate, or What for starting "Gas"): the ones that move to "gas". */
  found: { id: string; date: string; what: string; amount: number }[];
  /** Soft-deleted travel gas expenses: left alone. */
  archived: number;
}

export async function migrateGasCategory(fs: Firestore, opts: { dryRun?: boolean } = {}): Promise<MigrateGasCategoryResult> {
  const runId = newRunId();
  const ctx = importCtx("migrate-gas-category", runId);
  const out: MigrateGasCategoryResult = { runId, dryRun: !!opts.dryRun, found: [], archived: 0 };

  const travel = (await fs.collection("expenses").where("category", "==", "travel").get()).docs;
  for (const d of travel) {
    const data = d.data();
    const isGas = (data.gas !== undefined && data.gas !== null) || /^gas\b/i.test(String(data.what ?? "").trim());
    if (!isGas) continue;
    if (data.deletedAt) {
      out.archived++;
      continue;
    }
    out.found.push({ id: d.id, date: String(data.date ?? ""), what: String(data.what ?? ""), amount: Number(data.amount ?? 0) });
    if (opts.dryRun) continue;
    await run(ctx, (w) => w.update("expenses", d.id, { category: "gas" }));
  }
  return out;
}

async function main() {
  const write = process.argv.includes("--write");
  if (write && !process.env.FIRESTORE_EMULATOR_HOST && !process.argv.includes("--yes")) {
    throw new Error("This would write to REAL Firestore. Re-run without --write to look first, or add --yes if that is what you want.");
  }
  const r = await migrateGasCategory(firestore(), { dryRun: !write });
  const verb = write ? "Moved" : "Would move";
  console.log(`${verb} ${r.found.length} gas expense(s) from travel to gas (${r.archived} archived travel gas expense(s) left alone).`);
  for (const e of r.found.slice(0, 5)) console.log(`  ${e.date} ${e.what} ${formatCents(e.amount)} (${e.id})`);
  if (r.found.length > 5) console.log(`  ...and ${r.found.length - 5} more`);
  if (write && r.found.length) console.log(`History run ${r.runId}: Admin -> History -> filter by this run id -> Undo reverses it.`);
  console.log(`Run id: ${r.runId}`);
  if (!write) console.log("(dry run, nothing written: re-run with --write to move them)");
}

if (process.argv[1]?.endsWith("migrate-gas-category.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
