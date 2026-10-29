"use client";
import { useState } from "react";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { ErrorBox, useCommand } from "@/components/ui";
import { formatCents, INCOME_LABEL, METHOD_LABEL, type IncomeLike } from "@/lib/money";
import type { ShowDeal } from "@/schema/shows";
import { MoneyInModal } from "@/components/money/MoneyInModal";
import type { ShowRow } from "../common";
import { AdminOnlyBadge, ShowCard, UnfinishedPlaceholder } from "./kit";

const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
function dealLine(d: ShowDeal | null): string | null {
  if (!d) return null;
  const parts: string[] = [];
  if (d.deal === "doorSplit") parts.push(d.doorSplitPct !== undefined ? `Door split ${d.doorSplitPct} / ${100 - d.doorSplitPct}` : "Door split");
  else parts.push({ guarantee: "Guarantee", flat: "Flat fee", tips: "Tips only", free: "Free show" }[d.deal]);
  if (d.ticketPrice) parts.push(`${dollars(d.ticketPrice)} tickets`);
  if (d.paidAttendance !== undefined) parts.push(`${d.paidAttendance} paid`);
  return parts.join(" · ");
}

/** Money in (admins only): the income docs on this show, with a Received button on the ones still owed. */
export function IncomeCard({ show }: { show: ShowRow }) {
  const deal = useDoc<ShowDeal>("showDeals", show.id).doc;
  const rows = useCollection<IncomeLike>("income", { where: [["showId", "==", show.id]] }).rows;
  const income = [...(rows ?? [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const [open, setOpen] = useState(false);
  const [how, setHow] = useState<Record<string, string>>({});
  const { call, busy, error } = useCommand();
  const terms = dealLine(deal);
  const add = <button type="button" className="btn ghost" onClick={() => setOpen(true)} data-testid="money-in-open">+ Money in</button>;

  return (
    <ShowCard title="Money in" testid="income" badge={<AdminOnlyBadge />} aside={add}>
      {terms && <p className="s mb-2" data-testid="income-terms">{terms}</p>}
      {rows && income.length === 0 ? (
        <UnfinishedPlaceholder lead="No money in yet." testid="income-empty">Add the guarantee, door, tips or merch with + Money in.</UnfinishedPlaceholder>
      ) : (
        <div>
          {income.map((x) => (
            <div key={x.id} className="money-row" data-testid={`income-row-${x.id}`}>
              <span>{[INCOME_LABEL[x.category] ?? x.category, x.method ? METHOD_LABEL[x.method] ?? x.method : null].filter(Boolean).join(" · ")}</span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                <b>{formatCents(x.amount)}</b>
                {x.receivedAt ? <span className="pill ok" data-testid={`income-status-${x.id}`}>Received</span> : (
                  <>
                    <span className="chip owed" data-testid={`income-status-${x.id}`}>Owed to us</span>
                    {!x.method && (
                      <select className="select" style={{ width: 96 }} aria-label="How it was paid" value={how[x.id] ?? ""} onChange={(e) => setHow((h) => ({ ...h, [x.id]: e.target.value }))} data-testid={`income-how-${x.id}`}>
                        <option value="">How?</option>
                        {Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    )}
                    <button type="button" className="btn outline sm" disabled={busy} onClick={() => void call("income.setReceived", { id: x.id, ...(!x.method && how[x.id] ? { method: how[x.id] } : {}) })} data-testid={`income-received-${x.id}`}>Received</button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      <ErrorBox error={error} />
      <MoneyInModal open={open} onClose={() => setOpen(false)} defaults={{ showId: show.id, projectId: show.projectId }} />
    </ShowCard>
  );
}
