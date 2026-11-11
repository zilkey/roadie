"use client";
import { HBars } from "@/components/money/charts";
import { MoneyInCard, MoneyOutCard } from "@/components/money/MoneyCards";
import { useCollection } from "@/lib/firestore-hooks";
import { CATEGORY_LABEL, INCOME_LABEL, byCategory, countsAsPaidOut, defaultProject, formatCents, moneyRows, projectOf, projectTotals } from "@/lib/money";
import { spentByTrack } from "@/lib/releases";
import type { Expense, Income, Payout, Project } from "@/schema";
import type { ReleaseData } from "./common";

/** "+$1,180.00", "−$3,032.00", "$0.00". */
export const signed = (c: number) => `${c < 0 ? "−" : c > 0 ? "+" : ""}${formatCents(Math.abs(c))}`;

/** The release's money: where it stands (spent, earned, net, by category, by song), then the shared Money in and Money out cards on the release (tracks' lines included, tagged). Admins only. */
export function ReleaseMoney({ data }: { data: ReleaseData }) {
  if (!data.admin || !data.release) return null;
  return <View data={data} />;
}

function View({ data }: { data: ReleaseData }) {
  const release = data.release!;
  const projects = useCollection<Project>("projects");
  const income = useCollection<Income>("income");
  const expenses = useCollection<Expense>("expenses");
  const payouts = useCollection<Payout>("payouts");
  const context = { kind: "release" as const, releaseId: release.id, projectId: release.projectId };

  const def = defaultProject(projects.rows ?? [])?.id;
  const mine = <T extends { projectId?: string }>(xs: readonly T[] | null) => (xs ?? []).filter((x) => projectOf(x, def) === release.projectId);
  const inc = mine(income.rows), exp = mine(expenses.rows), pay = mine(payouts.rows);
  const t = projectTotals({ projectId: release.projectId, defaultProjectId: def, income: income.rows ?? [], expenses: expenses.rows ?? [], payouts: payouts.rows ?? [] });
  // The release page keeps the whole picture: spent is everything out (paid or still owed), earned everything in (received or owed).
  const spent = t.outPaid + t.outOwed;
  const earned = t.inReceived + t.inOwed;
  const net = earned - spent;

  const spentCats = byCategory(moneyRows({ income: [], expenses: exp, payouts: pay })).map((r) => ({ ...r, label: CATEGORY_LABEL[r.key] ?? r.key }));
  const earnedCats = byCategory(moneyRows({ income: inc, expenses: [], payouts: [] })).map((r) => ({ ...r, label: INCOME_LABEL[r.key] ?? r.key }));
  // Like the Spent tile: everything out, paid or still owed, so the songs and Whole release add up to it.
  const bySong = spentByTrack(data.tracks, [...exp, ...pay.filter(countsAsPaidOut)]);

  return (
    <div className="grid gap-5" data-testid="release-money">
      <section className="card" aria-labelledby="release-money-h">
        <div className="sg-sech">
          <h2 id="release-money-h" className="card-h">Where it stands</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-1" data-testid="tile-spent">
            <span className="lbl">Spent</span>
            <b className="font-mono text-xl" data-testid="release-spent-amount">{formatCents(spent)}</b>
          </div>
          <div className="grid gap-1" data-testid="tile-earned">
            <span className="lbl">Earned</span>
            <b className="font-mono text-xl" data-testid="release-earned-amount">{formatCents(earned)}</b>
            {t.inOwed > 0 && <span className="s">{formatCents(t.inOwed)} still owed</span>}
          </div>
          <div className="grid gap-1" data-testid="tile-net">
            <span className="lbl">Net so far</span>
            <b className="font-mono text-xl" data-testid="release-net-amount">{signed(net)}</b>
          </div>
        </div>
      </section>

      <div className="grid gap-5 sm:grid-cols-2">
        <HBars title="Spent by category" testid="spent-by-category" spent rows={spentCats} />
        <div className="grid content-start gap-2">
          <HBars title="Earned by source" testid="earned-by-source" rows={earnedCats} />
          <span className="s">Streaming and sync show up here once statements come in.</span>
        </div>
      </div>

      {data.tracks.length > 0 && <HBars title="Spent by song" testid="spent-by-song" spent rows={bySong} />}

      <MoneyInCard context={context} />
      <MoneyOutCard context={context} />
    </div>
  );
}
