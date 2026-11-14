"use client";
import { useEffect, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { runCommand } from "@/lib/commands";
import type { MoneySheetStatus } from "@/components/money/SendToSheet";

/**
 * Settings › Google › Money sheet: the caller's own books. They paste a Google Sheet they can edit and pick whose money goes
 * in it; Send to sheet on Money then keeps two tables in it (Roadie income, Roadie expenses) for their formulas to total.
 * Personal: only this admin sees it, and each admin can pick their own.
 */
export function MoneySheetCard() {
  const [status, setStatus] = useState<MoneySheetStatus | null>(null);
  const { call, error, busy, setError } = useCommand();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [note, setNote] = useState<string | null>(null);
  /** The radio shows a pick at once; the saved value takes over when the save answers (or puts it back if it fails). */
  const [picking, setPicking] = useState<"mine" | "band" | null>(null);
  useEffect(() => { runCommand<MoneySheetStatus>("google.moneySheet", {}).then(setStatus, (e: Error) => setError(e.message)); }, [setError]);

  async function save(input: { sheet?: string; whose?: "mine" | "band" }, saved: string) {
    setNote(null);
    const s = await call<MoneySheetStatus>("google.setMoneySheet", input);
    setPicking(null);
    if (!s) return;
    setStatus(s); setOpen(false); setLink(""); setNote(saved);
  }
  async function clear() {
    setNote(null);
    const s = await call<MoneySheetStatus>("google.clearMoneySheet", {});
    if (s) setStatus(s);
  }
  const sheet = status?.sheet;

  return (
    <section className={`card${open ? " editing" : ""}`} data-testid="google-money-sheet" aria-labelledby="google-money-sheet-title">
      <div className="card-head">
        <h2 id="google-money-sheet-title">Money sheet</h2>
        {status?.ready && !open && (
          <button type="button" className="card-edit" onClick={() => { setOpen(true); setNote(null); setError(null); }} data-testid="money-sheet-change">{sheet ? "Change" : "Choose"}</button>
        )}
      </div>
      <p className="m-0" data-testid="money-sheet-status">
        {sheet
          ? <><a href={sheet.url} target="_blank" rel="noreferrer" data-testid="money-sheet-link"><b>{sheet.title}</b> ↗</a>. Send to sheet on Money keeps its <b>Roadie income</b> and <b>Roadie expenses</b> tabs up to date for your own formulas.</>
          : "Your own books. Choose a Google Sheet you can edit, and Send to sheet on Money keeps two tables in it (Roadie income, Roadie expenses) for your formulas to total. Only you see this; each admin can pick their own."}
      </p>
      {status && !status.ready && <p className="s m-0" data-testid="money-sheet-needs-drive">Connect your Google account with Drive (Your Google account, above) to choose it.</p>}

      {open && (
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (link.trim()) void save({ sheet: link.trim() }, "Money sheet saved. Press Send to sheet on Money to fill it."); }} data-testid="money-sheet-form">
          <label htmlFor="money-sheet-q" className="lbl">Paste the Google Sheet&apos;s link</label>
          <div className="flex gap-2">
            <input id="money-sheet-q" className="input" value={link} autoFocus placeholder="https://docs.google.com/spreadsheets/d/…" onChange={(e) => { setLink(e.target.value); setError(null); }} data-testid="money-sheet-q" />
            <button className="btn ghost" disabled={busy || !link.trim()} data-testid="money-sheet-use">Use link</button>
          </div>
          <ErrorBox error={error} />
          <div className="card-foot"><div className="end">
            <button type="button" className="btn text" onClick={() => { setOpen(false); setLink(""); setError(null); }} data-testid="money-sheet-cancel">Cancel</button>
          </div></div>
        </form>
      )}

      {sheet && !open && (
        <fieldset className="m-0 grid gap-1 border-0 p-0" data-testid="money-sheet-whose">
          <legend className="lbl mb-1 p-0">Whose money</legend>
          {([
            ["mine", "Just mine", "Income that landed with me, expenses and pay I covered. The same rows as my Taxes page."],
            ["band", "The whole band's", "Everything on Money. The Received by and Paid by columns say whose it was."],
          ] as const).map(([v, name, what]) => (
            <label key={v} className="flex min-h-11 cursor-pointer items-start gap-2.5 py-1">
              <input type="radio" name="money-sheet-whose" className="mt-1 h-[18px] w-[18px]" checked={(picking ?? sheet.whose) === v} disabled={busy}
                onChange={() => { setPicking(v); void save({ whose: v }, "Saved. The next Send to sheet uses it."); }} data-testid={`money-sheet-whose-${v}`} />
              <span><b>{name}</b><br /><span className="s">{what}</span></span>
            </label>
          ))}
          <p className="s m-0">Every send replaces those two tabs completely, so anything typed in them is lost: fix a row in Roadie, not in the sheet. Your other tabs are never touched.</p>
        </fieldset>
      )}
      {note && <p className="s m-0" role="status" data-testid="money-sheet-note">{note}</p>}
      {!open && <ErrorBox error={error} />}
      {sheet && !open && (
        <div className="card-foot"><div className="end">
          <button type="button" className="btn text" disabled={busy} onClick={() => void clear()} data-testid="money-sheet-clear">Stop using it</button>
        </div></div>
      )}
    </section>
  );
}
