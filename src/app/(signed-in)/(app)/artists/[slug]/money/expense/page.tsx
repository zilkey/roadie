"use client";
import { BackLink } from "@/components/BackLink";
import { draftPath } from "@/schema/drafts";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useProfile } from "@/lib/auth";
import { ErrorBox, PageTitle, Select, useCommand } from "@/components/ui";
import { CategoryField } from "@/components/money/CategoryField";
import { GasFields, gasAmount, useGas } from "@/components/money/GasFields";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { defaultProject, dollarsToCents, EXPENSE_LABEL, formatCents, parseDollars } from "@/lib/money";
import { fmtLong, isOff, showName } from "@/lib/shows";
import { useTourEntries } from "@/components/tours/money";
import type { Release, Project, Rehearsal, Show, Tour, User } from "@/schema";

interface Hit { driveFileId: string; name: string; url: string }
const CATEGORIES = Object.entries(EXPENSE_LABEL) as [string, string][];
const fileIdOf = (url: string) => /\/d\/([\w-]+)/.exec(url)?.[1] ?? /[?&]id=([\w-]+)/.exec(url)?.[1] ?? url.replace(/\W+/g, "").slice(-24);

/**
 * The member expense page ("Add an expense"): a bandmate logs something they paid for. Admins log money through Money out;
 * if one opens this page it logs their own expense. Category is an autocomplete (gas when opened from a rehearsal or a
 * show or a drive, else gear). Gas uses the shared gas section with the driver fixed to the signed-in person (From their saved home,
 * or typed with "Save as my home"; To the rehearsal's location or the show's venue) and is always paid back; other
 * categories keep "The band should pay me back". ?rehearsalId fills the Project from the rehearsal (hidden Rehearsal);
 * ?showId (or ?show) fills it from the show and hides the Show and Project pickers. The receipt hides behind "Add receipt".
 * ?tourId (with optional ?tourEntryId) tags the expense to a tour: Project starts on the tour's "Money goes to", an "On (optional)"
 * select pins it to a drive, stay or show (or the whole tour), and Save/Cancel/Back return to the tour.
 * A new expense is a draft with an explicit Save button (you can still fix it until it's paid back); Cancel clears it.
 */
export default function Page() { return <Suspense><AddExpense /></Suspense>; }

function AddExpense() {
  const router = useRouter();
  const sp = useSearchParams();
  const me = useProfile();
  useArtist();
  const shows = useCollection<Show>("shows");
  const projects = useCollection<Project>("projects");
  const { call, error, busy } = useCommand();
  const fromShow = sp.get("showId") ?? sp.get("show") ?? "";
  const rehearsalId = sp.get("rehearsalId") ?? "";
  // Opened from a release's Money tab (or any project): that project is picked, and Save/Cancel go back to the release.
  const fromProject = sp.get("project") ?? "";
  const projectReleases = useCollection<Release>("releases", { where: [["projectId", "==", fromProject]], skip: !fromProject });
  const fromRelease = projectReleases.rows?.[0];
  // Opened from a tour: the expense is tagged to it (and optionally to one of its entries).
  const tourId = sp.get("tourId") ?? "";
  const tour = useDoc<Tour>("tours", tourId || "none").doc;
  const tourEntries = useTourEntries(tourId || undefined, false);
  const reh = useDoc<Rehearsal>("rehearsals", rehearsalId || "none");
  const rehearsal = rehearsalId ? reh.doc : null;
  // Opened from a rehearsal or show page: Save, Cancel and Back go back there.
  const returnTo = tourId ? `/tours/${tourId}` : rehearsalId ? `/rehearsals/${rehearsalId}?tab=money` : fromShow ? `/shows/${fromShow}?tab=finances` : fromRelease ? `/releases/${fromRelease.id}?tab=money` : "/money";
  const draft = useDraft(
    tourId ? draftPath.newUnder("tours", tourId, "expenses") : fromShow ? draftPath.newUnder("shows", fromShow, "expenses") : rehearsalId ? draftPath.newUnder("rehearsals", rehearsalId, "expenses")
      : fromProject ? draftPath.newUnder("projects", fromProject, "expenses") : draftPath.newIn("expenses"),
    {
      amount: "", amountEdited: false, what: "", cat: rehearsalId || fromShow ? "gas" : "gear", showId: fromShow, projectId: fromProject, tourEntryId: sp.get("tourEntryId") ?? "", link: "", payBack: true,
    },
    { title: (v) => `New expense · ${v.what || (v.amount ? `$${v.amount}` : "")}`.replace(/ · $/, "") });
  const mutationId = useRef(newMutationId());
  const { amount, what, cat, showId, projectId: pickedProject, link, tourEntryId } = draft.value;
  const isGas = cat === "gas";
  // Opened from a drive: once the tour's entries load, the category starts on gas (unless it was already changed).
  const gasForDrive = useRef(false);
  useEffect(() => {
    if (gasForDrive.current || !draft.ready || !sp.get("tourEntryId") || tourEntries.byId.get(sp.get("tourEntryId")!)?.kind !== "drive") return;
    gasForDrive.current = true;
    draft.setValue((d) => (d.cat === "gear" && !d.what && !d.amount ? { ...d, cat: "gas" } : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.ready, tourEntries.byId]);
  // Gas is always paid back; anything else is the person's choice.
  const payBack = isGas || draft.value.payBack !== false;
  const patch = (p: Partial<typeof draft.value>) => draft.setValue((d) => ({ ...d, ...p }));
  const [showReceipt, setShowReceipt] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const search = useCommand();

  const showDoc = showId ? shows.rows?.find((s) => s.id === showId) : undefined;
  const venue = showDoc?.venue;
  const venueText = [venue?.name, venue?.address, venue?.city].filter(Boolean).join(", ");
  // The signed-in person is the only driver (a member can't read the other users).
  const self = [{ id: me.uid, name: me.name ?? "You" } as Row<User>];
  // On a tour drive, From and To start on the drive's places.
  const drive = tourEntryId ? tourEntries.byId.get(tourEntryId) : undefined;
  const gas = useGas({ active: isGas && draft.ready, drivers: self, defaultDriver: me.uid, rehearsalId: rehearsalId || undefined, venueText: fromShow ? venueText : undefined,
    ...(drive?.kind === "drive" ? { from: drive.from, to: drive.to, roundTrip: drive.roundTrip } : {}) });

  // Pre-fill the amount from the gas estimate until the person types their own.
  const gasAmt = isGas ? gasAmount(gas) : "";
  useEffect(() => {
    if (gasAmt) draft.setValue((d) => (d.amountEdited ? d : { ...d, amount: gasAmt }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gasAmt]);

  const typedAmount = amount.trim() ? parseDollars(amount) : null;
  const cents = typedAmount ?? (amount.trim() && !isNaN(Number(amount)) ? dollarsToCents(amount) : 0);
  const note = what.trim();
  // A gas estimate with nothing typed files as plain "Gas".
  const whatOut = note || (isGas && gas.good ? "Gas" : "");
  // Project: the show's, else the rehearsal's (changeable), else what was picked, else the default.
  const openProjects = (projects.rows ?? []).filter((p) => p.status === "open").sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.name.localeCompare(b.name));
  const defaultId = defaultProject(projects.rows ?? [])?.id;
  const fixed = fromShow ? showDoc?.projectId : undefined;
  const projectId = [fixed, pickedProject, tour?.projectId, rehearsal?.projectId, showDoc?.projectId, defaultId].find((id) => id && openProjects.some((p) => p.id === id)) ?? "";
  const sorted = [...(shows.rows ?? [])].filter((s) => !isOff(s)).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30);

  async function find() {
    const r = await search.call<{ files: Hit[] }>("receipts.search", { q: q.trim() });
    if (r) setHits(r.files);
  }
  async function save() {
    const url = link.trim();
    await draft.settle();
    const { setAsRehearsalLocation: _admin, ...gasBits } = gas.payload(cents) as ReturnType<typeof gas.payload> & { setAsRehearsalLocation?: unknown };
    void _admin;
    const r = await call("expenses.add", {
      amount: cents, what: whatOut, category: cat, payBack, ...(projectId ? { projectId } : {}),
      ...(tourId ? { tourId, ...(tourEntryId ? { tourEntryId } : {}) } : {}),
      ...(showId && !rehearsalId ? { showId } : {}), ...(rehearsalId ? { rehearsalId } : {}),
      ...(url ? { receipt: { driveFileId: fileIdOf(url), url } } : {}),
      ...(isGas ? gasBits : {}),
    }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r) { await draft.clear(); router.push(returnTo); }
  }
  async function cancel() {
    await draft.clear({ reset: true });
    router.push(returnTo);
  }

  return (
    <div className="grid max-w-xl gap-5" data-testid="add-expense">
      <PageTitle back={<BackLink href={returnTo} label={tourId ? tour?.name ?? "Tour" : rehearsalId ? "Rehearsal" : fromShow ? "Show" : fromRelease ? fromRelease.title : "My money"} />} title="Add an expense"
        sub={rehearsal ? `Rehearsal · ${fmtLong(rehearsal.date)}` : showDoc ? showName(showDoc) : undefined} />
      {!draft.ready ? null : <div className="card">
        <CategoryField value={cat} options={CATEGORIES} onChange={(k) => patch({ cat: k })} testid="exp-cat" />

        {isGas && <GasFields g={gas} testid="exp" you hideDriver hideSetRehearsal />}

        <label className="grid gap-1"><span className="lbl">{isGas ? "Amount" : "How much"}</span>
          <input className="input font-mono" inputMode="decimal" placeholder={isGas ? "Or type the amount yourself" : "$0.00"} value={amount}
            onChange={(e) => patch({ amount: e.target.value, amountEdited: e.target.value.trim() !== "" })} data-testid="exp-amount" />
          {gasAmt && <span className="s">Pre-filled from the estimate. Change it if you paid something different.</span>}
        </label>
        <label className="grid gap-1"><span className="lbl">What for</span>
          <input className="input" placeholder={isGas ? "Gas to Fort Collins" : cat === "gear" ? "Drum heads" : "What was it"} value={what} onChange={(e) => patch({ what: e.target.value })} data-testid="expense-what" /></label>

        {!fromShow && <label className="grid gap-1"><span className="lbl">Project</span>
          <Select testid="exp-project" value={projectId} onChange={(v) => patch({ projectId: v })} options={openProjects.map((p) => [p.id, p.name] as [string, string])} /></label>}
        {!rehearsalId && !fromShow && <label className="grid gap-1"><span className="lbl">For a show?</span>
          <select className="select" value={showId} onChange={(e) => patch({ showId: e.target.value })} data-testid="expense-show">
            <option value="">Pick a show (optional)</option>
            {sorted.map((s) => <option key={s.id} value={s.id}>{fmtLong(s.date)} · {showName(s)}</option>)}
          </select></label>}

        {tourId && <label className="grid gap-1"><span className="lbl">On (optional)</span>
          <select className="select" value={tourEntryId} onChange={(e) => patch({ tourEntryId: e.target.value })} data-testid="expense-on">
            <option value="">Whole tour</option>
            {tourEntries.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select></label>}

        {showReceipt || link ? <>
          <span className="lbl">Receipt</span>
          <input className="input" placeholder="Paste a Drive link" value={link} onChange={(e) => patch({ link: e.target.value })} data-testid="expense-receipt" />
          <div className="flex gap-2">
            <input className="input" placeholder="…or search Drive" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && q.trim() && find()} data-testid="receipt-search" />
            <button type="button" className="btn ghost" disabled={!q.trim() || search.busy} onClick={find} data-testid="receipt-search-go">Search</button>
          </div>
          <ErrorBox error={search.error} />
          {hits && hits.length === 0 && <span className="s">No files found.</span>}
          {hits?.map((h) => (
            <button key={h.driveFileId} type="button" className="btn ghost sm justify-start" onClick={() => { patch({ link: h.url }); setHits(null); }} data-testid={`receipt-hit-${h.driveFileId}`}>{h.name}</button>
          ))}
        </> : <button type="button" className="btn ghost sm justify-self-start" onClick={() => setShowReceipt(true)} data-testid="expense-add-receipt">Add receipt</button>}

        {isGas ? <span className="s">Gas is always paid back.</span>
          : <label className="flex items-center gap-2"><input type="checkbox" checked={payBack} onChange={(e) => patch({ payBack: e.target.checked })} data-testid="expense-payback" /><span>The band should pay me back</span></label>}
        <span className="s">You can edit or remove it on My money until it's been paid back.</span>
        <ErrorBox error={error} />
        <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn ghost" onClick={cancel} data-testid="exp-cancel">Cancel</button>
          <button className="btn acc" disabled={busy || cents <= 0 || !whatOut} onClick={save} data-testid="exp-save">{cents > 0 ? `Save ${formatCents(cents)}` : "Save"}</button>
        </div>
      </div>}
    </div>
  );
}
