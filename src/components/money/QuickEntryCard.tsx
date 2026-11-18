"use client";
import { useEffect, useState } from "react";
import { useCollection } from "@/lib/firestore-hooks";
import { ErrorBox, useCommand } from "@/components/ui";
import { useArtist, Link } from "@/lib/artist";
import { useProfile } from "@/lib/auth";
import { AdminOnlyBadge, ShowCard } from "@/components/shows/page/kit";
import { INCOME_LABEL, METHOD_LABEL, defaultProject, formatCents, parseDollars, type ProjectLike } from "@/lib/money";
import { roleIn, type Income, type User } from "@/schema";
import type { QuickEntryRow } from "@/schema/artists";

/**
 * Quick entry (show Finances tab, admins only): the artist's template of income lines (Settings › Money) filled in at once after a show.
 * Each line has an amount, a "What for" when the row asks, and Received (ticked; unticked = still owed). Add writes the lines with income.addMany
 * on the show's project. The draft is kept per show in localStorage until Add or Cancel, so leaving the page and coming back restores it.
 * The booked guarantee, if still owed, pre-fills the first Guarantee row: Add marks that one received instead of adding a second.
 */
interface Draft { amounts: Record<string, string>; what: Record<string, string>; received: Record<string, boolean>; requestId: string }
const fresh = (): Draft => ({ amounts: {}, what: {}, received: {}, requestId: crypto.randomUUID() });
const key = (artistId: string, showId: string) => `roadie.quickEntry.${artistId}.${showId}`;
function load(k: string): Draft {
  try {
    const raw = window.localStorage.getItem(k);
    if (raw) { const d = JSON.parse(raw) as Partial<Draft>; return { ...fresh(), ...d, amounts: d.amounts ?? {}, what: d.what ?? {}, received: d.received ?? {} }; }
  } catch { /* storage blocked: start empty */ }
  return fresh();
}
const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const plain = (c: number) => (c % 100 ? (c / 100).toFixed(2) : String(c / 100));

export function QuickEntryCard({ show }: { show: { id: string; date: string; status: string; projectId?: string } }) {
  const { artistId, doc } = useArtist();
  const me = useProfile();
  const income = useCollection<Income>("income", { where: [["showId", "==", show.id]] }).rows;
  const projects = useCollection<ProjectLike>("projects").rows ?? [];
  const users = useCollection<User>("users").rows ?? [];
  const { call, busy, error } = useCommand();
  const k = key(artistId, show.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => { setDraft(load(k)); }, [k]);
  const [who, setWho] = useState("");

  if (show.status === "canceled" || show.status === "dropped") return null;
  const template = doc?.showQuickEntry?.rows ?? [];
  const projectName = projects.find((p) => p.id === (show.projectId ?? defaultProject(projects)?.id))?.name ?? "the default project";
  const admins = users.filter((u) => roleIn(u, artistId) === "admin").sort((a, b) => a.name.localeCompare(b.name));
  const whoVal = who || (admins.some((u) => u.id === me.userId) ? me.userId : admins[0]?.id ?? "");

  const head = (
    <span className="s">Goes on <b>{projectName}</b>, the show&apos;s project · dated {shortDate(show.date)}</span>
  );
  const shell = (children: React.ReactNode) => (
    <ShowCard title="Quick entry" testid="quick-entry" badge={<AdminOnlyBadge />} aside={head}>{children}</ShowCard>
  );
  if (doc && template.length === 0) {
    return shell(
      <p className="s">Set up the lines you fill in after every show (guarantee, tips, merch, cash or Venmo), and they&apos;ll show here.{" "}
        <Link href="/admin/money" data-testid="qe-setup-link">Set up quick entry</Link></p>,
    );
  }
  if (!draft || !doc || income === null) return shell(null);

  const owed = income.find((x) => x.category === "guarantee" && !x.receivedAt && !x.deletedAt);
  const firstGuarantee = template.find((r) => r.category === "guarantee")?.id;
  const amountText = (r: QuickEntryRow) => draft.amounts[r.id] ?? (owed && r.id === firstGuarantee ? plain(owed.amount) : "");
  const cents = (r: QuickEntryRow) => parseDollars(amountText(r));
  const filled = template.filter((r) => (cents(r) ?? 0) > 0);
  const badAmount = template.some((r) => amountText(r).trim() !== "" && cents(r) === null);
  const missingWhat = filled.some((r) => r.askWhatFor && !(draft.what[r.id] ?? "").trim());
  const total = filled.reduce((n, r) => n + (cents(r) ?? 0), 0);
  const change = (p: Partial<Draft>) => {
    const next = { ...draft, ...p };
    setDraft(next);
    try { window.localStorage.setItem(k, JSON.stringify(next)); } catch { /* storage blocked: the draft lives in this page only */ }
  };
  const clear = () => {
    try { window.localStorage.removeItem(k); } catch { /* ignore */ }
    setDraft(fresh());
  };
  const already = (r: QuickEntryRow) => income.filter((x) => !x.deletedAt && x.category === r.category && x.method === r.method).reduce((n, x) => n + x.amount, 0);

  async function add() {
    const lines = filled.map((r) => ({
      amount: cents(r)!, category: r.category, method: r.method, received: draft!.received[r.id] ?? true,
      ...(r.from ? { from: r.from } : {}), ...(r.askWhatFor && draft!.what[r.id]?.trim() ? { notes: draft!.what[r.id]!.trim() } : {}),
    }));
    const ok = await call("income.addMany", { showId: show.id, lines, ...(whoVal ? { receivedBy: whoVal } : {}), requestId: draft!.requestId });
    if (ok) clear();
  }

  return shell(
    <>
      {template.map((r) => {
        const prior = already(r);
        const isOwed = !!owed && r.id === firstGuarantee && draft.amounts[r.id] === undefined;
        return (
          <div key={r.id} className="money-row items-center flex-wrap gap-2" data-testid={`qe-line-${r.id}`}>
            <span>{INCOME_LABEL[r.category] ?? r.category} · {METHOD_LABEL[r.method] ?? r.method}</span>
            <span className="flex flex-wrap items-center gap-2">
              {r.askWhatFor && (
                <input className="input !w-auto" aria-label={`What for, ${INCOME_LABEL[r.category]}`} placeholder="What for" value={draft.what[r.id] ?? ""}
                  onChange={(e) => change({ what: { ...draft.what, [r.id]: e.target.value } })} data-testid={`qe-what-${r.id}`} />
              )}
              <input className="input !w-28" inputMode="decimal" aria-label={`Amount, ${INCOME_LABEL[r.category]} ${METHOD_LABEL[r.method]}`} placeholder="$0.00" value={amountText(r)}
                onChange={(e) => change({ amounts: { ...draft.amounts, [r.id]: e.target.value } })} data-testid={`qe-amount-${r.id}`} />
              <label className="flex items-center gap-1.5 s">
                <input type="checkbox" checked={draft.received[r.id] ?? true} onChange={(e) => change({ received: { ...draft.received, [r.id]: e.target.checked } })} data-testid={`qe-received-${r.id}`} /> Received
              </label>
            </span>
            {(isOwed || prior > 0) && (
              <span className="s basis-full" style={{ color: "var(--owed-text)" }} data-testid={`qe-note-${r.id}`}>
                {[isOwed ? `The booked ${formatCents(owed!.amount)} guarantee: Add marks it received` : null, prior > 0 ? `already has ${formatCents(prior)} on this show` : null].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
        <label className="flex items-center gap-2 s">Who got it
          <select className="select !w-auto" value={whoVal} onChange={(e) => setWho(e.target.value)} data-testid="qe-who">
            {admins.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <span className="s">{filled.length} {filled.length === 1 ? "line" : "lines"} · {formatCents(total)}</span>
        <span className="flex items-center gap-2">
          <button type="button" className="btn outline" onClick={clear} data-testid="qe-cancel">Cancel</button>
          <button type="button" className="btn acc" disabled={busy || filled.length === 0 || badAmount || missingWhat} onClick={() => void add()} data-testid="qe-add">
            Add {filled.length} {filled.length === 1 ? "line" : "lines"}
          </button>
        </span>
      </div>
      <ErrorBox error={error} />
    </>,
  );
}
