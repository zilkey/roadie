"use client";
import { BackLink } from "@/components/BackLink";
import { draftPath } from "@/schema/drafts";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useProfile } from "@/lib/auth";
import { ErrorBox, PageTitle, PickChip, Select, useCommand } from "@/components/ui";
import { AddressAutocomplete, type Place } from "@/components/AddressAutocomplete";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { defaultProject, dollarsToCents, EXPENSE_LABEL, formatCents, parseDollars } from "@/lib/money";
import { fmtLong, isOff, showName } from "@/lib/shows";
import { roleIn, type Album, type ExpenseCategory, type Project, type Rehearsal, type Show, type User } from "@/schema";

/** The chips on the form: the ledger's expense categories, the common ones first. */
const FIRST = ["travel", "food", "gear", "lodging"];
const CATS = [...FIRST, ...Object.keys(EXPENSE_LABEL).filter((k) => !FIRST.includes(k))] as ExpenseCategory[];

interface Hit { driveFileId: string; name: string; url: string }
/** What expenses.estimateGas replies with (numbers, or `missing`). */
interface Estimate {
  missing: ("mpg" | "home" | "destination" | "price")[];
  fromKind: "home" | "typed"; roundTrip: boolean;
  oneWayMiles?: number; miles?: number; mpg?: number; grade?: "regular" | "midgrade" | "premium" | "diesel";
  priceMilli?: number; priceArea?: string; priceWeek?: string; seriesId?: string; source?: string; estimateCents?: number;
}
const fileIdOf = (url: string) => /\/d\/([\w-]+)/.exec(url)?.[1] ?? /[?&]id=([\w-]+)/.exec(url)?.[1] ?? url.replace(/\W+/g, "").slice(-24);
const placeLabel = (p?: { name?: string; address?: string }) => [p?.name, p?.address].filter(Boolean).join(", ");
const warnBox = "grid gap-2 rounded-xl p-4";
const warnStyle = { background: "var(--unfinished)", color: "var(--unfinished-text)" } as const;

export default function Page() { return <Suspense><AddExpense /></Suspense>; }

function AddExpense() {
  const router = useRouter();
  const sp = useSearchParams();
  const me = useProfile();
  const { artistId } = useArtist();
  const isAdmin = me.role === "admin";
  const shows = useCollection<Show>("shows");
  const projects = useCollection<Project>("projects");
  const users = useCollection<User>("users", { skip: !isAdmin });
  const { call, error, busy } = useCommand();
  const est = useCommand();
  const estCall = useRef(est.call); estCall.current = est.call;
  // A new expense is a draft with an explicit Save button (you can still fix it until it's paid back).
  const fromShow = sp.get("show") ?? "";
  const rehearsalId = sp.get("rehearsalId") ?? "";
  // Opened from an album's Money tab (or any project): that project is picked, and Save/Cancel go back to the album.
  const fromProject = sp.get("project") ?? "";
  const projectAlbums = useCollection<Album>("albums", { where: [["projectId", "==", fromProject]], skip: !fromProject });
  const fromAlbum = projectAlbums.rows?.[0];
  const reh = useDoc<Rehearsal>("rehearsals", rehearsalId || "none");
  const rehearsal = rehearsalId ? reh.doc : null;
  const rehLoc = rehearsal?.location;
  const rehHasLoc = !!(rehLoc && (rehLoc.address || rehLoc.lat !== undefined));
  // Opened from a rehearsal or show page: Save, Cancel and Back go back there.
  const returnTo = rehearsalId ? `/rehearsals/${rehearsalId}?tab=money` : fromShow ? `/shows/${fromShow}?tab=finances` : fromAlbum ? `/albums/${fromAlbum.id}?tab=money` : "/money";
  const draft = useDraft(
    fromShow ? draftPath.newUnder("shows", fromShow, "expenses") : rehearsalId ? draftPath.newUnder("rehearsals", rehearsalId, "expenses")
      : fromProject ? draftPath.newUnder("projects", fromProject, "expenses") : draftPath.newIn("expenses"),
    {
      amount: "", amountEdited: false, what: "", cat: (rehearsalId ? "travel" : "gear") as ExpenseCategory, showId: fromShow, projectId: fromProject, link: "", payBack: true,
      forId: "", fromPick: null as Place | null, toPick: null as Place | null, roundTrip: true, mpgText: "",
      saveMpg: true, saveHome: true, setRehearsal: true,
    },
    { title: (v) => `New expense · ${v.what || (v.amount ? `$${v.amount}` : "")}`.replace(/ · $/, "") });
  const mutationId = useRef(newMutationId());
  const { amount, what, cat, showId, projectId: pickedProject, link, forId, fromPick, toPick, roundTrip, mpgText } = draft.value;
  const payBack = draft.value.payBack !== false;
  const patch = (p: Partial<typeof draft.value>) => draft.setValue((d) => ({ ...d, ...p }));
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const search = useCommand();
  const [need, setNeed] = useState({ mpg: false, home: false, dest: false });
  const [last, setLast] = useState<{ key: string; r: Estimate } | null>(null);

  const forOther = isAdmin && !!forId && forId !== me.uid;
  const mpgNum = Number(mpgText);
  const mpgTyped = mpgText.trim() !== "" && mpgNum > 0;
  const bandmates = (users.rows ?? []).filter((u) => ["admin", "member"].includes(roleIn(u, artistId)) && u.id !== me.uid).sort((a, b) => a.name.localeCompare(b.name));

  // ---- the estimate: runs whenever the inputs settle (300 ms) ----
  const estInput = {
    ...(forOther ? { forId } : {}),
    ...(fromPick ? { from: { address: fromPick.address, lat: fromPick.lat, lng: fromPick.lng } } : {}),
    ...(toPick ? { to: toPick } : {}),
    ...(rehearsalId ? { rehearsalId } : {}),
    ...(mpgTyped ? { mpg: mpgNum } : {}),
    roundTrip,
  };
  const key = JSON.stringify(estInput);
  useEffect(() => {
    if (cat !== "travel" || !draft.ready) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await estCall.current<Estimate>("expenses.estimateGas", JSON.parse(key));
      if (!live || !r) return;
      setLast({ key, r });
      setNeed((n) => ({ mpg: n.mpg || r.missing.includes("mpg"), home: n.home || r.missing.includes("home"), dest: n.dest || r.missing.includes("destination") }));
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [key, cat, draft.ready]);
  const cur = cat === "travel" && last?.key === key ? last.r : null;
  const good = cur && cur.missing.length === 0 && cur.estimateCents && cur.miles && cur.oneWayMiles && cur.mpg && cur.priceMilli && cur.priceArea && cur.priceWeek && cur.seriesId && cur.grade ? cur : null;
  const missing = cur?.missing ?? [];

  // Pre-fill the amount from the estimate until the person types their own.
  const goodCents = good?.estimateCents;
  useEffect(() => {
    if (goodCents) draft.setValue((d) => (d.amountEdited ? d : { ...d, amount: (goodCents / 100).toFixed(2) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goodCents]);

  const typedAmount = amount.trim() ? parseDollars(amount) : null;
  const cents = typedAmount ?? (amount.trim() && !isNaN(Number(amount)) ? dollarsToCents(amount) : 0);
  const note = what.trim();
  // A gas estimate with nothing typed files as plain "Gas".
  const whatOut = note || (cat === "travel" && good ? "Gas" : "");
  // Project: what was picked, else the show's, else the default (rehearsals have no project of their own).
  const openProjects = (projects.rows ?? []).filter((p) => p.status === "open").sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.name.localeCompare(b.name));
  const showProject = shows.rows?.find((s) => s.id === showId)?.projectId;
  const defaultId = defaultProject(projects.rows ?? [])?.id;
  const projectId = [pickedProject, showProject, defaultId].find((id) => id && openProjects.some((p) => p.id === id)) ?? "";
  const sorted = [...(shows.rows ?? [])].filter((s) => !isOff(s)).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30);

  const showMpgBox = cat === "travel" && (need.mpg || missing.includes("mpg") || mpgTyped);
  const showHomeBox = cat === "travel" && (need.home || missing.includes("home"));
  const showToBox = cat === "travel" && (need.dest || missing.includes("destination") || (!rehHasLoc && !!toPick));
  const toLabel = placeLabel(rehLoc);

  async function find() {
    const r = await search.call<{ files: Hit[] }>("receipts.search", { q: q.trim() });
    if (r) setHits(r.files);
  }
  async function save() {
    const url = link.trim();
    await draft.settle();
    const toOut = toPick ?? (rehLoc ? { name: rehLoc.name, address: rehLoc.address, lat: rehLoc.lat, lng: rehLoc.lng } : {});
    const gas = good && cents > 0 ? {
      fromKind: good.fromKind, ...(good.fromKind === "typed" && fromPick ? { fromText: fromPick.address } : {}),
      to: toOut, oneWayMiles: good.oneWayMiles!, roundTrip: good.roundTrip, miles: good.miles!, mpg: good.mpg!, grade: good.grade!,
      priceMilli: good.priceMilli!, priceArea: good.priceArea!, priceWeek: good.priceWeek!, seriesId: good.seriesId!, estimateCents: good.estimateCents!,
    } : undefined;
    const own = !forOther;
    const r = await call("expenses.add", {
      amount: cents, what: whatOut, category: cat, payBack, ...(projectId ? { projectId } : {}),
      ...(showId && !rehearsalId ? { showId } : {}), ...(rehearsalId ? { rehearsalId } : {}),
      ...(forOther ? { userId: forId } : {}),
      ...(url ? { receipt: { driveFileId: fileIdOf(url), url } } : {}),
      ...(gas ? { gas } : {}),
      ...(gas && own && showMpgBox && mpgTyped && draft.value.saveMpg ? { saveMpg: true } : {}),
      ...(gas && own && showHomeBox && fromPick && draft.value.saveHome ? { saveAsHome: { ...(fromPick.name ? { name: fromPick.name } : {}), address: fromPick.address, lat: fromPick.lat, lng: fromPick.lng } } : {}),
      ...(gas && isAdmin && rehearsalId && !rehHasLoc && toPick && draft.value.setRehearsal ? { setAsRehearsalLocation: { ...(toPick.name ? { name: toPick.name } : {}), address: toPick.address, lat: toPick.lat, lng: toPick.lng } } : {}),
    }, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
    if (r) { await draft.clear(); router.push(returnTo); }
  }
  async function cancel() {
    await draft.clear({ reset: true });
    router.push(returnTo);
  }

  const miles = good?.miles ?? cur?.miles;
  const oneWay = cur?.oneWayMiles;
  const fromShowDoc = fromShow ? shows.rows?.find((s) => s.id === fromShow) : undefined;
  return (
    <div className="grid max-w-xl gap-5" data-testid="add-expense">
      <PageTitle back={<BackLink href={returnTo} label={rehearsalId ? "Rehearsal" : fromShow ? "Show" : fromAlbum ? fromAlbum.title : "My money"} />} title="Add an expense"
        sub={rehearsal ? `Rehearsal · ${fmtLong(rehearsal.date)}` : fromShowDoc ? showName(fromShowDoc) : undefined} />
      {!draft.ready ? null : <div className="card">
        <div className="grid gap-2">
          <span className="lbl">Category</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Category">
            {CATS.map((k) => (
              <PickChip key={k} on={cat === k} onToggle={() => patch({ cat: k })} testid={`exp-cat-${k}`}>{EXPENSE_LABEL[k]}</PickChip>
            ))}
          </div>
        </div>

        {isAdmin && <label className="grid gap-1">
          <span className="lbl">For (optional) · Admins only</span>
          <Select testid="exp-for" value={forId} onChange={(v) => { setNeed({ mpg: false, home: false, dest: false }); setLast(null); patch({ forId: v, mpgText: "" }); }}
            options={[["", `Me (${me.name ?? "you"})`] as [string, string], ...bandmates.map((u) => [u.id, u.name] as [string, string])]} />
          <span className="s">Pick a bandmate to log it for them. It shows in their expenses and they get paid back. Gas uses their home address and MPG.</span>
        </label>}

        {cat === "travel" && <>
          {showHomeBox ? (
            <div className={warnBox} style={warnStyle}>
              <span className="lbl" style={{ color: "inherit" }}>From — where did you start?</span>
              <AddressAutocomplete value={fromPick ? placeLabel(fromPick) : ""} placeholder="Start typing an address…" testId="exp-from"
                onPick={(p) => patch({ fromPick: p })} onChange={() => fromPick && patch({ fromPick: null })} />
              <span className="s" style={{ color: "inherit" }}>{forOther ? "They haven't saved a home address, so this can't be filled in for them." : "You haven't saved a home address, so this can't be filled in for you."}</span>
              {!forOther && <label className="flex items-center gap-2"><input type="checkbox" checked={draft.value.saveHome} onChange={(e) => patch({ saveHome: e.target.checked })} data-testid="exp-save-home" /><span>Save as my home address</span></label>}
            </div>
          ) : (
            <label className="grid gap-1">
              <span className="flex items-baseline justify-between gap-2"><span className="lbl">From</span><span className="s">{forOther ? "Their home address" : "Your home address"}</span></span>
              <AddressAutocomplete value={fromPick ? placeLabel(fromPick) : ""} placeholder={forOther ? "Their home address" : "Your home address"} testId="exp-from"
                onPick={(p) => patch({ fromPick: p })} onChange={() => fromPick && patch({ fromPick: null })} />
            </label>
          )}

          {showToBox ? (
            <div className={warnBox} style={warnStyle}>
              <span className="lbl" style={{ color: "inherit" }}>{rehearsalId ? "To — where was rehearsal?" : "To — where did you drive?"}</span>
              <AddressAutocomplete value={toPick ? placeLabel(toPick) : ""} placeholder="Start typing an address or place…" testId="exp-to"
                onPick={(p) => patch({ toPick: p })} onChange={() => toPick && patch({ toPick: null })} />
              {rehearsalId && !rehHasLoc && <span className="s" style={{ color: "inherit" }}>This rehearsal doesn't have an address yet.</span>}
              {isAdmin && rehearsalId && !rehHasLoc && <label className="flex items-center gap-2"><input type="checkbox" checked={draft.value.setRehearsal} onChange={(e) => patch({ setRehearsal: e.target.checked })} data-testid="exp-set-rehearsal-location" /><span>Also set this as the rehearsal location <span className="s">(admins only)</span></span></label>}
            </div>
          ) : (
            <label className="grid gap-1">
              <span className="flex items-baseline justify-between gap-2"><span className="lbl">To</span>{rehearsalId && <span className="s">Rehearsal location</span>}</span>
              <AddressAutocomplete value={toPick ? placeLabel(toPick) : ""} placeholder={toLabel || "Where to?"} testId="exp-to"
                onPick={(p) => patch({ toPick: p })} onChange={() => toPick && patch({ toPick: null })} />
            </label>
          )}

          <button type="button" role="switch" aria-checked={roundTrip} onClick={() => patch({ roundTrip: !roundTrip })} data-testid="exp-roundtrip"
            className="flex min-h-11 cursor-pointer items-center justify-between gap-3 border-0 bg-transparent p-0 text-left" style={{ font: "inherit", color: "var(--ink)" }}>
            <span>Round trip <span className="s">— doubles the distance</span></span>
            <span aria-hidden className="inline-flex items-center rounded-full p-[3px]" style={{ width: 44, height: 26, background: roundTrip ? "var(--accent)" : "var(--input-border)", justifyContent: roundTrip ? "flex-end" : "flex-start" }}>
              <span className="block rounded-full" style={{ width: 20, height: 20, background: "#fff" }} />
            </span>
          </button>

          {showMpgBox && (
            <div className={warnBox} style={warnStyle}>
              {missing.includes("mpg") && <b>We need {forOther ? "their" : "your"} car's MPG to estimate this</b>}
              <label className="grid gap-1"><span className="lbl" style={{ color: "inherit" }}>Miles per gallon</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input className="input" style={{ width: 120 }} inputMode="decimal" placeholder="e.g. 28" value={mpgText} onChange={(e) => patch({ mpgText: e.target.value })} data-testid="exp-mpg-inline" />
                  <a href="https://www.fueleconomy.gov/feg/findacar.shtml" target="_blank" rel="noreferrer">Look up my car's MPG</a>
                </div></label>
              {!forOther && <label className="flex items-center gap-2"><input type="checkbox" checked={draft.value.saveMpg} onChange={(e) => patch({ saveMpg: e.target.checked })} data-testid="exp-save-mpg" /><span>Save to my settings so I don't have to enter it again</span></label>}
            </div>
          )}

          <div className="grid gap-2 rounded-xl p-4" style={{ background: "var(--soft)" }} data-testid="exp-estimate" aria-live="polite">
            <div className="flex justify-between gap-3"><span className="s">Distance</span>
              <span className="font-mono">{oneWay === undefined ? (missing.includes("home") ? "— needs a start address" : missing.includes("destination") ? "— needs a destination" : "—") : roundTrip ? `${oneWay} mi × 2 = ${miles} mi` : `${oneWay} mi one way`}</span></div>
            <div className="flex justify-between gap-3"><span className="s">{forOther ? "Their car" : "Your car"}</span>
              <span>{cur?.mpg ? `${cur.mpg} MPG` : <span className="s">— MPG needed</span>}</span></div>
            <div className="flex justify-between gap-3"><span className="s">Gas price</span>
              {cur?.priceMilli ? <span className="text-right">${(cur.priceMilli / 1000).toFixed(2)} / gal {cur.grade}{cur.source && <><br /><span className="s">{cur.source}</span></>}</span>
                : <span className="s">{missing.includes("price") ? "— no price available" : "—"}</span>}</div>
            <div className="flex justify-between gap-3 pt-2" style={{ borderTop: "1px solid var(--line)" }}>
              <span className="s">{good ? `${good.miles!.toFixed(1)} mi ÷ ${good.mpg} MPG × $${(good.priceMilli! / 1000).toFixed(2)}` : est.busy ? "Working it out…" : missing.includes("mpg") ? "Estimate appears once MPG is in" : missing.includes("home") ? "Estimate appears once From is set" : missing.includes("destination") ? "Estimate appears once To is set" : "Estimate appears here"}</span>
              <b className="font-mono" data-testid="exp-estimate-cost">{good ? formatCents(good.estimateCents!) : "—"}</b>
            </div>
          </div>
          <ErrorBox error={est.error} />
        </>}

        <label className="grid gap-1"><span className="lbl">{cat === "travel" ? "Amount" : "How much"}</span>
          <input className="input font-mono" inputMode="decimal" placeholder={cat === "travel" ? "Or type the amount yourself" : "$0.00"} value={amount}
            onChange={(e) => patch({ amount: e.target.value, amountEdited: e.target.value.trim() !== "" })} data-testid="exp-amount" />
          {good && <span className="s">Pre-filled from the estimate. Change it if you paid something different.</span>}
        </label>
        <label className="grid gap-1"><span className="lbl">What for</span>
          <input className="input" placeholder={cat === "travel" ? "Gas to Fort Collins" : cat === "gear" ? "Drum heads" : "What was it"} value={what} onChange={(e) => patch({ what: e.target.value })} data-testid="expense-what" /></label>

        <label className="grid gap-1"><span className="lbl">Project</span>
          <Select testid="exp-project" value={projectId} onChange={(v) => patch({ projectId: v })} options={openProjects.map((p) => [p.id, p.name] as [string, string])} /></label>
        {!rehearsalId && <label className="grid gap-1"><span className="lbl">For a show?</span>
          <select className="select" value={showId} onChange={(e) => patch({ showId: e.target.value })} data-testid="expense-show">
            <option value="">Pick a show (optional)</option>
            {sorted.map((s) => <option key={s.id} value={s.id}>{fmtLong(s.date)} · {showName(s)}</option>)}
          </select></label>}
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
        <label className="flex items-center gap-2"><input type="checkbox" checked={payBack} onChange={(e) => patch({ payBack: e.target.checked })} data-testid="expense-payback" /><span>Pay me back</span></label>
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
