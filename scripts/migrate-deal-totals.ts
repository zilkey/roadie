/**
 * Fill showDeals.totals (income and expenses for the Played table) for every played show:
 *   tsx scripts/migrate-deal-totals.ts [--dry-run] [--yes]
 * From then on the server keeps totals itself (refreshDealTotals). Writes go through the normal writer (history + rev,
 * via "import"). Safe to run again: a deal whose totals already match is left alone.
 * Against real Firestore (no emulator host) it needs --yes.
 */
import type { Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { run } from "@/server/db";
import { refreshDealTotals } from "@/server/dealTotals";
import { showTotals, type LedgerLike } from "@/lib/money";
import { showFilter } from "@/lib/shows";
import { dateInBandZone } from "@/lib/timezone";

export interface MigrateDealTotalsResult {
  updated: { id: string; income: number; expenses: number }[];
}

export async function migrateDealTotals(fs: Firestore, opts: { dryRun?: boolean; today?: string } = {}): Promise<MigrateDealTotalsResult> {
  const ctx = importCtx("migrate-deal-totals");
  const today = opts.today ?? dateInBandZone();
  const rows = async (path: string) => (await fs.collection(path).get()).docs.map((d) => ({ ...d.data(), id: d.id }) as Record<string, unknown> & { id: string });
  const [shows, deals, ledger, expenses] = await Promise.all([rows("shows"), rows("showDeals"), rows("ledger"), rows("expenses")]);
  const dealById = new Map(deals.filter((d) => !d.deletedAt).map((d) => [d.id, d]));
  const out: MigrateDealTotalsResult = { updated: [] };
  for (const s of shows) {
    if (s.deletedAt || !dealById.has(s.id) || showFilter(s as never, today) !== "played") continue;
    const t = showTotals({
      ledger: ledger.filter((e) => e.showId === s.id) as unknown as LedgerLike[],
      expenses: expenses.filter((x) => x.showId === s.id) as unknown as { amount: number; deletedAt?: unknown }[],
    });
    const cur = dealById.get(s.id)!.totals as { income: number; expenses: number } | undefined;
    if (cur && cur.income === t.income && cur.expenses === t.expenses) continue;
    out.updated.push({ id: s.id, ...t });
    if (!opts.dryRun) await run(ctx, (w) => refreshDealTotals(w, s.id));
  }
  return out;
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await migrateDealTotals(firestore(), { dryRun: flag("dry-run") });
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  for (const u of r.updated) console.log(`${flag("dry-run") ? "Would set" : "Set"} show ${u.id}: income ${usd(u.income)}, expenses ${usd(u.expenses)}`);
  console.log(`${r.updated.length} deal(s) updated${flag("dry-run") ? " (dry run, nothing written)" : ""}.`);
}

if (process.argv[1]?.endsWith("migrate-deal-totals.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
