"use client";
import { useEffect, useState } from "react";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { runCommand } from "@/lib/commands";
import type { SheetBlank } from "@/lib/moneySheet";

export interface MoneySheetView { title: string; url: string; whose: "mine" | "band"; sentAt: string | null; sentIncome: number | null; sentExpenses: number | null }
export interface MoneySheetStatus { ready: boolean; sheet: MoneySheetView | null }
interface SendResult extends MoneySheetStatus { income: number; expenses: number; blanks: SheetBlank[] }

const when = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return today ? `today ${time}` : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
};
const WHY: Record<SheetBlank["why"], string> = {
  no_method: "no method, so Cash is blank",
  no_receiver: "nobody is down as receiving it, so it's left out of Just mine",
};
const short = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Send to sheet on Money: the button, the "Sent to …" line under the title, and the result dialog. Rewrites the caller's
 * Money sheet (Settings › Google) in full. Off, with a hint, until they have chosen one.
 */
export function useSendToSheet() {
  const [status, setStatus] = useState<MoneySheetStatus | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const { call, error, busy, setError } = useCommand();
  useEffect(() => { runCommand<MoneySheetStatus>("google.moneySheet", {}).then(setStatus, () => setStatus(null)); }, []);

  async function send() {
    const r = await call<SendResult>("google.sendMoneySheet", {});
    if (r) { setStatus(r); setResult(r); }
  }
  const sheet = status?.sheet;
  const off = !sheet || !status?.ready;
  const hint = !status ? "Loading…" : !sheet ? "Choose a Money sheet in Settings › Google first" : !status?.ready ? "Connect your Google account with Drive in Settings › Google first" : `Rewrite the Roadie tabs in ${sheet.title}`;

  const button = (
    <button type="button" className="btn outline" disabled={off || busy} title={hint} aria-label={off ? `Send to sheet. ${hint}` : undefined} onClick={() => void send()} data-testid="money-sheet-send">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="13" height="13" rx="2" /><path d="M2.5 7h13M2.5 11h13M7 7v8.5" /></svg>
      {busy ? "Sending…" : "Send to sheet"}
    </button>
  );
  const line = sheet?.sentAt ? (
    <span data-testid="money-sheet-sent">Sent to <a href={sheet.url} target="_blank" rel="noreferrer">{sheet.title}</a> · {when(sheet.sentAt)}</span>
  ) : undefined;
  const dialog = (
    <>
      {error && !result && <ErrorBox error={error} />}
      <Dialog open={!!result} onClose={() => { setResult(null); setError(null); }} title={`Sent to ${result?.sheet?.title ?? "your sheet"}`} testid="money-sheet-result">
        {result && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-line p-3"><div className="s">Roadie income</div><b className="text-xl" data-testid="money-sheet-income">{result.income} {result.income === 1 ? "row" : "rows"}</b></div>
              <div className="rounded-lg border border-line p-3"><div className="s">Roadie expenses</div><b className="text-xl" data-testid="money-sheet-expenses">{result.expenses} {result.expenses === 1 ? "row" : "rows"}</b></div>
            </div>
            {result.blanks.length > 0 && (
              <div className="card admin gap-1" data-testid="money-sheet-blanks">
                <b className="admin-label">{result.blanks.length} {result.blanks.length === 1 ? "row" : "rows"} your formulas may miss</b>
                <ul className="m-0 grid gap-1 pl-5">
                  {result.blanks.map((b) => (
                    <li key={`${b.why}-${b.id}`} data-testid={`money-sheet-blank-${b.id}`}><a href={b.href}>{b.what}, {short(b.date)}</a> · {WHY[b.why]}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn text" onClick={() => setResult(null)} data-testid="money-sheet-done">Done</button>
              <a className="btn" href={result.sheet?.url} target="_blank" rel="noreferrer" data-testid="money-sheet-open">Open the sheet</a>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
  return { button, line, dialog };
}
