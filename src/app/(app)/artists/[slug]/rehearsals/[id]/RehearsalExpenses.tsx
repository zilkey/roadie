"use client";
import Link from "@/lib/artist";
import { useProfile } from "@/lib/auth";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { formatCents, sumExpenses } from "@/lib/money";
import type { Expense, Musician, User } from "@/schema";

/** The category a row shows: gas and room rental and gear by their ledger category, food by what it was logged as. */
function categoryLabel(x: Expense): string {
  if (x.category === "travel") return x.gas ? "Gas" : "Travel";
  if (x.category === "space") return "Room rental";
  if (x.category === "gear") return "Gear";
  if (x.what.split(" · ")[0] === "Food") return "Food";
  return "Other";
}

/** A gas row reads from its frozen estimate; anything else shows what it was logged as. */
function details(x: Row<Expense>): string {
  const g = x.gas;
  if (!g) return x.what;
  const base = `${g.miles.toFixed(1)} mi ${g.roundTrip ? "round trip" : "one way"} · ${g.mpg} MPG · $${(g.priceMilli / 1000).toFixed(2)}/gal`;
  const note = x.what.split(" · ").slice(1).join(" · ");
  return note ? `${base} · ${note}` : base;
}

/**
 * The rehearsal page's expenses card. Admins see every expense logged against this rehearsal, with the person it is for.
 * Members see only their own (the query filters userId, and Firestore rules allow nothing else), with no band total.
 */
export default function RehearsalExpenses({ rehearsalId }: { rehearsalId: string }) {
  const me = useProfile();
  const isAdmin = me.role === "admin";
  const expenses = useCollection<Expense>("expenses", {
    where: isAdmin ? [["rehearsalId", "==", rehearsalId]] : [["userId", "==", me.uid], ["rehearsalId", "==", rehearsalId]],
  });
  const users = useCollection<User>("users", { skip: !isAdmin });
  const musicians = useCollection<Musician>("musicians", { skip: !isAdmin });

  const rows = [...(expenses.rows ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = sumExpenses(rows);
  const nameOf = (userId: string) =>
    users.rows?.find((u) => u.id === userId)?.name ?? musicians.rows?.find((m) => m.userId === userId)?.name ?? "Someone";
  const addHref = `/money/expense?rehearsalId=${encodeURIComponent(rehearsalId)}`;

  return (
    <section className="card grid gap-3" data-testid="reh-expenses-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 className="text-base font-semibold">
            {isAdmin ? "Expenses" : "My expenses"}{" "}
            <span className="s font-medium" data-testid="reh-expenses-total">· {formatCents(total)}{isAdmin ? " total" : ""}</span>
          </h2>
          <span className="s">{isAdmin ? "Admin view · everyone's expenses" : "Only yours show here"}</span>
        </div>
        <Link href={addHref} className="btn acc sm" data-testid="reh-expenses-add">+ Add an expense</Link>
      </div>

      {expenses.rows === null ? (
        <span className="s">Loading…</span>
      ) : rows.length === 0 ? (
        isAdmin ? (
          <p className="text-sm">Nothing logged for this rehearsal yet.</p>
        ) : (
          <p className="text-sm">Nothing yet. Drove here or paid for something? Add it and the band pays you back.</p>
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs">
                {isAdmin && <th scope="col" className="s py-2 pr-2 font-medium">For</th>}
                <th scope="col" className="s px-2 py-2 font-medium">Category</th>
                <th scope="col" className="s px-2 py-2 font-medium">Details</th>
                <th scope="col" className="s px-2 py-2 font-medium">Status</th>
                <th scope="col" className="s py-2 pl-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const paid = !!x.paidBackAt;
                return (
                  <tr key={x.id} className="border-t border-line" data-testid="reh-expense-row">
                    {isAdmin && <td className="py-3 pr-2 font-medium">{nameOf(x.userId)}</td>}
                    <td className="px-2 py-3">{categoryLabel(x)}</td>
                    <td className="s px-2 py-3">{details(x)}</td>
                    <td className="px-2 py-3"><span className={`chip ${paid ? "g" : ""}`}>{paid ? "Paid" : "Pending"}</span></td>
                    <td className="py-3 pl-2 text-right font-mono">{formatCents(x.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
