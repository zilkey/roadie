/**
 * Moves old show and money fields to the shapes the rebuilt show page uses, without losing anything:
 *   tsx scripts/migrate-show-page.ts [--dry-run] [--yes]
 * Shows:
 *   - checklist (one list) and gear  -> checklists [{name "Gig prep"}, {name "Gear"}] (packed -> done, who brings it -> ownerId)
 *   - times.setLength (minutes)      -> times.setLengthSec (seconds)
 *   - bandNotes                      -> a band comment on the show (by whoever last edited it, dated then)
 *   - public ("public show")         -> publishToBandsintown
 * Show deals (the ledger is gone; its documents are left in place, unread):
 *   - live ledger income on the show -> income lines, received (a venmo line becomes tips paid by Venmo)
 *   - live ledger expense on the show -> an expense on the show (paid by whoever recorded it, nothing to pay back)
 *   - guarantee with no guarantee received -> an income line, not received; the guarantee field is cleared
 * Expenses: a live ledger reimbursement -> paidBackAt / paidBackBy.
 * Not moved (reported): payouts, owed payouts, ledger entries on no show.
 * Live docs are written through the normal writer (history + rev, via "import"); soft-deleted ones are fixed in place.
 * Safe to run again: each part only touches docs still in the old shape. Against real Firestore (no emulator host) it needs --yes.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { run, type Doc } from "@/server/db";
import { refreshDealTotals } from "@/server/dealTotals";
import { checklistsOf } from "@/lib/shows";
import { CATEGORY_LABEL } from "@/lib/money";

export interface MigrateShowPageResult {
  shows: { id: string; checklists: number; setLength: boolean; bandNotes: boolean; published: boolean }[];
  deals: { id: string; income: number; expenses: number; guarantee: boolean }[];
  paidBack: string[];
  notMoved: { payouts: number; owedPayouts: number; noShow: number };
}

type Row = Record<string, unknown> & { id: string };
const INCOME_CATEGORY: Record<string, string> = { guarantee: "guarantee", door: "door", merch: "merch", tips: "tips", venmo: "tips" };

export async function migrateShowPage(fs: Firestore, opts: { dryRun?: boolean } = {}): Promise<MigrateShowPageResult> {
  const ctx = importCtx("migrate-show-page");
  const rows = async (path: string) => (await fs.collection(path).get()).docs.map((d) => ({ ...d.data(), id: d.id }) as Row);
  const [shows, deals, ledger, expenses] = await Promise.all([rows("shows"), rows("showDeals"), rows("ledger"), rows("expenses")]);
  const out: MigrateShowPageResult = { shows: [], deals: [], paidBack: [], notMoved: { payouts: 0, owedPayouts: 0, noShow: 0 } };

  // Ledger entries that still count: not corrections, not reversed by one.
  const reversed = new Set(ledger.filter((e) => e.kind === "correction" && e.reversesId).map((e) => e.reversesId as string));
  const live = ledger.filter((e) => e.kind !== "correction" && !reversed.has(e.id));
  out.notMoved.payouts = live.filter((e) => e.kind === "payout").length;
  out.notMoved.noShow = live.filter((e) => !e.showId && e.kind !== "reimbursement").length;
  out.notMoved.owedPayouts = deals.reduce((n, d) => n + ((d.owedPayouts as unknown[] | undefined)?.length ?? 0), 0);

  /** Writes a patch (null = remove the field): through the writer for live docs, in place for soft-deleted ones. */
  async function patchDoc(path: string, d: Row, patch: Record<string, unknown>, extra?: (w: Parameters<Parameters<typeof run>[1]>[0]) => Promise<unknown>) {
    if (opts.dryRun) return;
    if (d.deletedAt) {
      await fs.collection(path).doc(d.id).update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === null ? FieldValue.delete() : v])));
      return;
    }
    await run(ctx, async (w) => { await w.update(path, d.id, patch); await extra?.(w); });
  }

  for (const s of shows) {
    const times = (s.times ?? {}) as Record<string, unknown>;
    const legacyLists = !s.checklists && (s.checklist !== undefined || s.gear !== undefined);
    const setLength = typeof times.setLength === "number";
    const notes = typeof s.bandNotes === "string" ? s.bandNotes.trim() : "";
    const legacyPublic = s.public !== undefined;
    if (!legacyLists && !setLength && s.bandNotes === undefined && !legacyPublic) continue;
    const patch: Record<string, unknown> = {};
    if (legacyLists) Object.assign(patch, { checklists: checklistsOf(s as never), checklist: null, gear: null });
    if (setLength) {
      const { setLength: min, ...rest } = times;
      patch.times = { ...rest, ...(rest.setLengthSec ? {} : { setLengthSec: (min as number) * 60 }) };
    }
    if (s.bandNotes !== undefined) patch.bandNotes = null;
    if (legacyPublic) Object.assign(patch, { public: null, ...(s.publishToBandsintown === undefined && s.public ? { publishToBandsintown: true } : {}) });
    out.shows.push({ id: s.id, checklists: legacyLists ? (patch.checklists as unknown[]).length : 0, setLength, bandNotes: !!notes, published: legacyPublic && !!s.public });
    await patchDoc("shows", s, patch, async (w) => {
      if (!notes) return;
      const by = (s.updatedBy ?? s.createdBy) as string;
      await w.create(`shows/${s.id}/comments`, { authorId: by, body: notes, audience: "band" }, { keep: { createdAt: (s.updatedAt ?? s.createdAt) as never, createdBy: by } });
    });
    if (notes && s.deletedAt && !opts.dryRun) {
      // A soft-deleted show still keeps its notes, as a comment written in place.
      const by = (s.updatedBy ?? s.createdBy) as string;
      await fs.collection(`shows/${s.id}/comments`).add({ authorId: by, body: notes, audience: "band", createdAt: s.updatedAt ?? s.createdAt, updatedAt: s.updatedAt ?? s.createdAt, createdBy: by, updatedBy: by, via: "import", runId: "migrate-show-page", deletedAt: null, schemaVersion: 1, rev: 1 });
    }
  }

  for (const d of deals) {
    if (d.income !== undefined) continue;
    const mine = live.filter((e) => e.showId === d.id);
    const income = mine.filter((e) => e.kind === "income").map((e, i) => ({
      id: `l${i + 1}`, category: INCOME_CATEGORY[e.category as string] ?? "other", amount: e.amount as number,
      method: e.category === "venmo" ? "venmo" : (e.method as string | undefined), received: true,
    })).map((l) => (l.method ? l : (({ method: _m, ...r }) => r)(l)));
    const guarantee = typeof d.guarantee === "number" && d.guarantee > 0 && !income.some((l) => l.category === "guarantee");
    if (guarantee) income.unshift({ id: "l0", category: "guarantee", amount: d.guarantee as number, received: false });
    const spent = mine.filter((e) => e.kind === "expense");
    out.deals.push({ id: d.id, income: income.length, expenses: spent.length, guarantee });
    await patchDoc("showDeals", d, { income, ...(d.guarantee !== undefined ? { guarantee: null } : {}) }, async (w) => {
      const made: Doc[] = [];
      for (const e of spent) {
        const r = await w.create("expenses", {
          userId: e.createdBy, date: e.date, amount: e.amount, category: e.category, what: (e.memo as string | undefined) ?? CATEGORY_LABEL[e.category as string] ?? "Expense",
          showId: d.id, payBack: false, ...(e.receipt ? { receipt: e.receipt } : {}),
        });
        made.push((await w.get("expenses", r.id))!);
      }
      await refreshDealTotals(w, d.id, { expenses: made });
    });
  }

  for (const r of live.filter((e) => e.kind === "reimbursement" && e.expenseId)) {
    const x = expenses.find((e) => e.id === r.expenseId) as Doc | undefined;
    if (!x || x.paidBackAt) continue;
    out.paidBack.push(x.id);
    await patchDoc("expenses", x as Row, { paidBackAt: r.date, paidBackBy: r.createdBy });
  }
  return out;
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await migrateShowPage(firestore(), { dryRun: flag("dry-run") });
  const verb = flag("dry-run") ? "Would migrate" : "Migrated";
  for (const s of r.shows) console.log(`${verb} show ${s.id}: ${s.checklists} checklist(s)${s.setLength ? ", set length to seconds" : ""}${s.bandNotes ? ", band notes -> comment" : ""}${s.published ? ", public -> published to Bandsintown" : ""}`);
  for (const d of r.deals) console.log(`${verb} deal ${d.id}: ${d.income} income line(s)${d.guarantee ? " (guarantee not received)" : ""}, ${d.expenses} ledger expense(s) -> expenses`);
  if (r.paidBack.length) console.log(`${verb} ${r.paidBack.length} reimbursement(s) -> paid back: ${r.paidBack.join(", ")}`);
  const n = r.notMoved;
  console.log(`Left in the ledger, not moved: ${n.payouts} payout(s), ${n.noShow} entr${n.noShow === 1 ? "y" : "ies"} on no show; ${n.owedPayouts} owed payout(s) stay on their deals.`);
}

if (process.argv[1]?.endsWith("migrate-show-page.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
