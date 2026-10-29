"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useArtist } from "@/lib/artist";
import { ErrorBox, Select, useCommand } from "@/components/ui";
import { useCollection, useDoc, useDocs, type Row } from "@/lib/firestore-hooks";
import { PanelStatus, useInstantSave } from "@/components/shows/saved";
import { useProfile } from "@/lib/auth";
import { EXPENSE_LABEL, METHOD_LABEL, PAYOUT_KIND_LABEL, formatCents, parseDollars } from "@/lib/money";
import { dateInBandZone } from "@/lib/timezone";
import { fmtLong, showName } from "@/lib/shows";
import { roleIn, type Contact, type Expense, type Musician, type Payout, type Project, type Release, type ReleaseTrack, type Show, type User } from "@/schema";
import { sortTracks } from "@/lib/releases";
import type { MoneyDefaults, MoneyOutModalProps } from "./modals";
import { CategoryField } from "./CategoryField";
import { GasFields, gasAmount, useGas } from "./GasFields";


/** The native <dialog> both money modals sit in: closed unless `open`, and the form inside is keyed on each open so it resets. */
export function MoneyDialog({ open, onClose, testid, title, children }: { open: boolean; onClose(): void; testid: string; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="pitch-dlg" data-testid={testid} aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && children}
    </dialog>
  );
}

export function ModalHead({ title, sub, onClose, testid }: { title: string; sub?: string; onClose(): void; testid: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-divider" style={{ padding: "18px 14px 14px 22px" }}>
      <div className="grid min-w-0 flex-1">
        <h2 className="text-[1.25rem] font-extrabold leading-[1.3]">{title}</h2>
        {sub && <span className="text-[0.875rem] text-muted">{sub}</span>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" data-testid={testid}
        className="grid shrink-0 place-items-center border-0 bg-transparent text-muted" style={{ width: 44, height: 44, borderRadius: 10 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}

/** A two-way toggle (We owe / We paid, Owed to us / We got it). */
export function Toggle({ value, a, b, onChange, name, testidA, testidB }: {
  value: "a" | "b"; a: string; b: string; onChange(v: "a" | "b"): void; name: string; testidA: string; testidB: string;
}) {
  return (
    <div className="seg wide" role="radiogroup">
      <label><input type="radio" name={name} checked={value === "a"} onChange={() => onChange("a")} data-testid={testidA} />{a}</label>
      <label><input type="radio" name={name} checked={value === "b"} onChange={() => onChange("b")} data-testid={testidB} />{b}</label>
    </div>
  );
}

/** The opener's defaults with its `context` folded in: the context's project, show and track become the starting picks. */
export function withContext(d: MoneyDefaults | undefined): MoneyDefaults | undefined {
  const c = d?.context;
  if (!c) return d;
  if (c.kind === "show") return { ...d, showId: c.showId, projectId: c.projectId ?? d.projectId };
  if (c.kind === "rehearsal") return { ...d, projectId: c.projectId ?? d.projectId };
  if (c.kind === "release") return { ...d, projectId: c.projectId, releaseTrackId: undefined };
  return { ...d, projectId: c.projectId, releaseTrackId: c.releaseTrackId };
}

/** Shared pickers: open projects and shows (newest first). */
export function useProjectsAndShows(defaults: { projectId?: string; showId?: string } | undefined) {
  const projects = useCollection<Project>("projects");
  const shows = useCollection<Show>("shows");
  const open = useMemo(() => (projects.rows ?? []).filter((p) => p.status !== "closed").sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || a.name.localeCompare(b.name)), [projects.rows]);
  const sortedShows = useMemo(() => [...(shows.rows ?? [])].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")), [shows.rows]);
  const [projectPick, setProjectPick] = useState<string | null>(null);
  const [showId, setShowId] = useState(defaults?.showId ?? "");
  const show = sortedShows.find((s) => s.id === showId);
  // Untouched: the opener's project, else the chosen show's (if still open), else the default project.
  const projectId = projectPick ?? [defaults?.projectId, show?.projectId as string | undefined].find((p) => p && open.some((o) => o.id === p)) ?? open.find((p) => p.isDefault)?.id ?? open[0]?.id ?? "";
  return { open, shows: sortedShows, show, projectId, setProjectPick, showId, setShowId };
}

/** Project and Show pickers; a `context` hides the ones its record decides (show: both; release or track: Project). */
export function ProjectShowFields({ s, prefix, context }: { s: ReturnType<typeof useProjectsAndShows>; prefix: string; context?: MoneyDefaults["context"] }) {
  const hideProject = context?.kind === "show" || context?.kind === "release" || context?.kind === "track";
  const hideShow = context?.kind === "show";
  if (hideProject && hideShow) return null;
  return (
    <div className={`grid gap-[14px]${hideProject || hideShow ? "" : " sm:grid-cols-2"}`}>
      {!hideProject && <label className="grid gap-1">
        <span className="lbl">Project</span>
        <select className="select" value={s.projectId} onChange={(e) => s.setProjectPick(e.target.value)} data-testid={`${prefix}-project`}>
          {s.open.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>}
      {!hideShow && <label className="grid gap-1">
        <span className="lbl">Show <span className="font-normal">(optional)</span></span>
        <select className="select" value={s.showId} onChange={(e) => s.setShowId(e.target.value)} data-testid={`${prefix}-show`}>
          <option value="">None</option>
          {s.shows.map((x) => <option key={x.id} value={x.id}>{showName(x)} · {fmtLong(x.date)}</option>)}
        </select>
      </label>}
    </div>
  );
}

/**
 * The release behind the picked project (a release's project is its own) and its tracks, so money can be pinned to one
 * track. Nothing when the project is not a release's. The pick is kept only while that release's project stays picked.
 */
export function useReleaseTracks(projectId: string, defaults: { releaseTrackId?: string } | undefined) {
  const releases = useCollection<Release>("releases");
  const release = useMemo(() => (releases.rows ?? []).find((r) => r.projectId === projectId) ?? null, [releases.rows, projectId]);
  const tracks = useCollection<ReleaseTrack>(release ? `releases/${release.id}/tracks` : "releases/none/tracks", { skip: !release });
  const [pick, setPick] = useState(defaults?.releaseTrackId ?? "");
  // Another project picked: the track goes with the old one.
  const first = useRef(true);
  useEffect(() => { if (first.current) first.current = false; else setPick(""); }, [projectId]);
  const sorted = useMemo(() => sortTracks(tracks.rows ?? []), [tracks.rows]);
  const trackId = release && sorted.some((t) => t.id === pick) ? pick : "";
  return { release, tracks: sorted, trackId, setTrackId: setPick };
}

/** "Track (optional)": only when the picked project is a release's. */
export function TrackField({ t, prefix, context }: { t: ReturnType<typeof useReleaseTracks>; prefix: string; context?: MoneyDefaults["context"] }) {
  if (!t.release || context?.kind === "release" || context?.kind === "track") return null;
  return (
    <label className="grid gap-1">
      <span className="lbl">Track <span className="font-normal">(optional)</span></span>
      <select className="select" value={t.trackId} onChange={(e) => t.setTrackId(e.target.value)} data-testid={`${prefix}-track`}>
        <option value="">Whole release</option>
        {t.tracks.map((x) => <option key={x.id} value={x.id}>{x.position} · {x.title}</option>)}
      </select>
    </label>
  );
}

export function MethodWhenFields({ method, setMethod, when, setWhen, prefix }: {
  method: string; setMethod(v: string): void; when: string; setWhen(v: string): void; prefix: string;
}) {
  return (
    <div className="grid gap-[14px] sm:grid-cols-2">
      <label className="grid gap-1">
        <span className="lbl">How</span>
        <select className="select" value={method} onChange={(e) => setMethod(e.target.value)} data-testid={`${prefix}-method`}>
          <option value="">Pick one</option>
          {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="lbl">When</span>
        <input className="input" type="date" value={when} onChange={(e) => setWhen(e.target.value)} data-testid={`${prefix}-when`} />
      </label>
    </div>
  );
}

export const shortDate = (d: string) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

/** The preview above Save: a bold sentence and a muted "Saved as…" line, or (no sentence) just "Saved as…" in bold. */
export function ModalFoot({ sentence, saves, error, busy, canSave, onCancel, prefix }: {
  sentence?: string; saves: string; error: string | null; busy: boolean; canSave: boolean; onCancel(): void; prefix: string;
}) {
  return (
    <>
      <div className="grid gap-[2px] border-t border-divider" style={{ padding: "14px 22px 0" }}>
        {sentence && <span className="font-bold" data-testid={`${prefix}-sentence`}>{sentence}</span>}
        <span className={sentence ? "text-[0.875rem] text-muted" : "font-bold"} data-testid={`${prefix}-saves`}>{saves}</span>
      </div>
      <div style={{ padding: "0 22px" }}><ErrorBox error={error} /></div>
      <div className="flex flex-wrap justify-end gap-[10px]" style={{ padding: "14px 22px 20px" }}>
        <button type="button" className="btn ghost" onClick={onCancel} data-testid={`${prefix}-cancel`}>Cancel</button>
        <button type="submit" className="btn acc" disabled={!canSave || busy} data-testid={`${prefix}-save`}>Save</button>
      </div>
    </>
  );
}

/** What kind of money out: a vendor bill or purchase, a bandmate's own expense the band owes back, or a payout. */
type Kind = "expense" | "reimb" | "pay" | "split" | "other";
const KINDS: [Kind, string][] = [["expense", "A bill or purchase"], ["reimb", "Reimbursable expense"], ["pay", PAYOUT_KIND_LABEL.pay], ["split", PAYOUT_KIND_LABEL.split], ["other", PAYOUT_KIND_LABEL.other]];
const CATEGORIES = Object.entries(EXPENSE_LABEL) as [string, string][];
const fileIdOf = (url: string) => /\/d\/([\w-]+)/.exec(url)?.[1] ?? /[?&]id=([\w-]+)/.exec(url)?.[1] ?? url.replace(/\W+/g, "").slice(-24);

/** A person or vendor money goes to, as picked: the stored `to` shape plus a key for the list. */
export interface WhoOption { key: string; name: string; sub?: string; to: { musicianId: string } | { userId: string } | { contactId: string } | { name: string } }

/**
 * Who money went to: type a few letters and pick from band members, players, contacts and anyone named before, or keep
 * what you typed as a plain name ("Someone else"). The picked option's name sits in the box; typing again clears it.
 */
export function WhoPicker({ options, value, onChange, testid, allowOther = true, placeholder = "Type a name" }: {
  options: WhoOption[]; value: WhoOption | null; onChange(v: WhoOption | null): void; testid: string; allowOther?: boolean; placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const q = query.trim().toLowerCase();
  const hits = q ? options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 8) : [];
  const exact = hits.some((o) => o.name.toLowerCase() === q);
  const pick = (o: WhoOption) => { onChange(o); setQuery(""); setOpen(false); };
  return (
    <div className="relative grid gap-1">
      <input className="input" type="text" autoComplete="off" placeholder={placeholder} value={value ? value.name : query} data-testid={`${testid}-input`}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { if (value) onChange(null); setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" && q) { e.preventDefault(); if (hits[0] && (exact || !allowOther)) pick(hits[0]); else if (allowOther) pick({ key: `n:${query.trim()}`, name: query.trim(), to: { name: query.trim() } }); } }} />
      {open && q && !value && (hits.length > 0 || allowOther) && (
        <div className="card absolute left-0 right-0 top-full z-10 mt-1 grid gap-0 p-1" role="listbox" data-testid={`${testid}-list`}>
          {hits.map((o) => (
            <button key={o.key} type="button" role="option" aria-selected={false} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-soft" data-testid={`${testid}-hit-${o.key}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}>
              <span>{o.name}</span>{o.sub && <span className="s">{o.sub}</span>}
            </button>
          ))}
          {allowOther && !exact && (
            <button type="button" role="option" aria-selected={false} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-soft" data-testid={`${testid}-other`} onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick({ key: `n:${query.trim()}`, name: query.trim(), to: { name: query.trim() } })}>
              <span>Use “{query.trim()}”</span><span className="s">someone else</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Everyone money can go to: band users, players without a login, contacts, and names typed before (from existing records). */
export function useWhoOptions(i: { users: readonly Row<User>[]; musicians: readonly Row<Musician>[]; contacts: readonly Row<Contact>[]; priorNames?: readonly string[] }): WhoOption[] {
  return useMemo(() => {
    const out: WhoOption[] = [];
    for (const u of [...i.users].sort((a, b) => a.name.localeCompare(b.name))) out.push({ key: `u:${u.id}`, name: u.name, sub: "band", to: { userId: u.id } });
    for (const m of i.musicians.filter((m) => !m.userId && !m.archivedAt).sort((a, b) => a.name.localeCompare(b.name))) out.push({ key: `m:${m.id}`, name: m.name, sub: "player", to: { musicianId: m.id } });
    for (const c of [...i.contacts].sort((a, b) => a.name.localeCompare(b.name))) out.push({ key: `c:${c.id}`, name: c.name, sub: c.title || "contact", to: { contactId: c.id } });
    const seen = new Set(out.map((o) => o.name.toLowerCase()));
    for (const n of i.priorNames ?? []) if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push({ key: `n:${n}`, name: n, to: { name: n } }); }
    return out;
  }, [i.users, i.musicians, i.contacts, i.priorNames]);
}

/** The admins of this artist, A–Z: the only people who can be a payer (money leaves their own account; the band has none). */
export function useAdmins(users: readonly Row<User>[]) {
  const { artistId } = useArtist();
  return useMemo(() => users.filter((u) => roleIn(u, artistId) === "admin").sort((a, b) => a.name.localeCompare(b.name)), [users, artistId]);
}
/** Everyone in the band (admins and members), A–Z: anyone can have paid for something out of their own pocket. */
export function useBandUsers(users: readonly Row<User>[]) {
  const { artistId } = useArtist();
  return useMemo(() => users.filter((u) => ["admin", "member"].includes(roleIn(u, artistId))).sort((a, b) => a.name.localeCompare(b.name)), [users, artistId]);
}

export function PayerField({ admins, value, onChange, testid, label = "Who paid" }: { admins: readonly Row<User>[]; value: string; onChange(v: string): void; testid: string; label?: string }) {
  return (
    <label className="grid gap-1">
      <span className="lbl">{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
        <option value="">Pick an admin</option>
        {admins.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    </label>
  );
}

/**
 * "We owe" / "We paid" someone: a bill or purchase (an expense, with who was paid and who paid), a bandmate's reimbursable
 * expense (the same expense a member logs themselves: they paid, the band owes them back; We paid also pays them back),
 * or a payout. Opened with no props but open/onClose, or with defaults from the page. A `context` (modals.ts) hides what its
 * record decides and writes its ids (rehearsalId too, on expenses and payouts). Category is an autocomplete; Gas turns the
 * form into the gas form (GasFields.tsx): an expense the driver paid, always paid back, with the miles estimate.
 * With `defaults.edit` it edits one existing expense (bill or paid) or payout instead: ExpenseEdit / PayoutEdit below. Every
 * field autosaves on change or blur (only the changed field is sent) and the footer has one Done; a paid-back expense is read-only.
 */
export function MoneyOutModal({ open, onClose, defaults }: MoneyOutModalProps) {
  return (
    <MoneyDialog open={open} onClose={onClose} testid="money-out-modal" title={defaults?.markPaid ? "Mark paid" : "Money out"}>
      {defaults?.markPaid ? <MarkPaidForm onClose={onClose} target={defaults.markPaid} />
        : defaults?.edit?.kind === "expense" ? <ExpenseEdit id={defaults.edit.id} context={defaults.context} onClose={onClose} />
        : defaults?.edit?.kind === "payout" ? <PayoutEdit id={defaults.edit.id} context={defaults.context} onClose={onClose} />
        : <OutForm onClose={onClose} defaults={defaults} />}
    </MoneyDialog>
  );
}

function OutForm({ onClose, defaults: given }: { onClose(): void; defaults?: MoneyOutModalProps["defaults"] }) {
  const context = given?.context;
  const defaults = withContext(given);
  const rehearsalId = context?.kind === "rehearsal" ? context.rehearsalId : "";
  const rehearsal = rehearsalId ? { rehearsalId } : {};
  const { call, error, busy } = useCommand();
  const me = useProfile();
  const users = useCollection<User>("users");
  const musicians = useCollection<Musician>("musicians");
  const contacts = useCollection<Contact>("contacts");
  const expensesAll = useCollection<Expense>("expenses");
  const payoutsAll = useCollection<Payout>("payouts");
  const ps = useProjectsAndShows(defaults);
  const tr = useReleaseTracks(ps.projectId, defaults);
  const track = tr.trackId ? { releaseTrackId: tr.trackId } : {};
  const reimburse = !!defaults?.expenseIds?.length;
  const owed = useDocs<Expense>("expenses", defaults?.expenseIds ?? [], { skip: !reimburse });

  const [paid, setPaid] = useState<boolean>(!!defaults?.paid || reimburse);
  const [kind, setKind] = useState<Kind>("expense");
  const [who, setWho] = useState<WhoOption | null>(null);
  const [touchedWho, setTouchedWho] = useState(false);
  const [amount, setAmount] = useState("");
  const [what, setWhat] = useState("");
  const [category, setCategory] = useState(defaults?.category ?? "other");
  const [amountEdited, setAmountEdited] = useState(false);
  const [link, setLink] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [method, setMethod] = useState("");
  const [when, setWhen] = useState(dateInBandZone());
  const [payer, setPayer] = useState(me.role === "admin" ? me.uid : "");
  const [payBack, setPayBack] = useState(false);
  // Reimbursable: the bandmate who paid out of pocket (the We owe card opens this on a person).
  const [member, setMember] = useState(defaults?.userId ?? "");

  const userRows = users.rows ?? [];
  const admins = useAdmins(userRows);
  const bandUsers = useBandUsers(userRows);
  // Gas: a bill or a bandmate's expense in the Gas category becomes the gas form (an expense the driver paid, always paid back).
  const gasOn = category === "gas" && !reimburse && (kind === "expense" || kind === "reimb");
  const venue = ps.show?.venue;
  const venueText = [venue?.name, venue?.address, venue?.city].filter(Boolean).join(", ");
  const gas = useGas({ active: gasOn, drivers: bandUsers, defaultDriver: defaults?.userId, rehearsalId, venueText: context?.kind === "show" ? venueText : undefined });
  const gasAmt = gasAmount(gas);
  useEffect(() => { if (gasOn && gasAmt && !amountEdited) setAmount(gasAmt); }, [gasOn, gasAmt, amountEdited]);
  const priorNames = useMemo(() => [...new Set([...(expensesAll.rows ?? []).map((x) => x.to?.name), ...(payoutsAll.rows ?? []).map((p) => p.to.name)].filter((n): n is string => !!n))], [expensesAll.rows, payoutsAll.rows]);
  // Venue contacts stay out of the To list: the band almost never pays one. (The command still takes a contactId.)
  const options = useWhoOptions({ users: userRows, musicians: musicians.rows ?? [], contacts: [], priorNames });
  // The We owe card opens this on a person: they are the To until the admin picks someone else.
  const musicianUser = (mid?: string) => (musicians.rows ?? []).find((m) => m.id === mid)?.userId;
  const defaultKey = defaults?.userId ? `u:${defaults.userId}` : defaults?.musicianId ? (musicianUser(defaults.musicianId) ? `u:${musicianUser(defaults.musicianId)}` : `m:${defaults.musicianId}`) : "";
  const expense = kind === "expense";
  const reimb = kind === "reimb";
  // Reimbursable: the person the We owe card opened on is the member who paid, not a To.
  const to = touchedWho ? who : reimb ? null : (options.find((o) => o.key === defaultKey) ?? who);
  const reimbUser = defaults?.userId ?? owed.rows[0]?.userId ?? "";
  const nameOfUser = (uid: string) => userRows.find((u) => u.id === uid)?.name ?? "";
  const memberName = nameOfUser(member);
  const personName = reimburse ? nameOfUser(reimbUser) : reimb ? memberName : to?.name ?? "";
  const payerName = nameOfUser(payer);
  const cents = reimburse ? owed.rows.reduce((n, x) => n + x.amount, 0) : parseDollars(amount);
  const whatText = reimburse ? "" : what.trim() || (gasOn ? "Gas" : "");
  const forText = whatText || (ps.show ? `the ${showName(ps.show)} show` : "");

  const needsPayer = !gasOn && (paid || reimburse);
  const needsMethod = !gasOn && ((paid && !expense) || reimburse);
  const driverName = gas.driverName;
  const canSave = gasOn ? !!gas.driverId && !!cents && cents > 0 && !!ps.projectId && !!whatText && !!when
    : (reimburse ? !!reimbUser && owed.rows.length > 0 : reimb ? !!member : !!to) && !!cents && cents > 0 && !!ps.projectId && (!(expense || reimb) || reimburse || !!whatText)
    && (!needsPayer || (!!payer && !!when)) && (!needsMethod || !!method) && (!reimb || !!when);

  const sentence = gasOn ? `${driverName || "Someone"} paid ${cents ? formatCents(cents) : "$0.00"} for ${whatText.toLowerCase() === "gas" ? "gas" : whatText}${forText && whatText.toLowerCase() === "gas" ? ` for ${forText}` : ""}`
    : reimb && paid ? `${payerName || "Someone"} paid ${memberName || "a bandmate"} back ${cents ? formatCents(cents) : "$0.00"}${forText ? ` for ${forText}` : ""}`
    : `${paid ? "We paid" : "We owe"} ${personName || "someone"} ${cents ? formatCents(cents) : "$0.00"}${forText ? ` for ${forText}` : ""}`;
  const paidBit = paid ? ` (${payerName || "who?"}${needsMethod ? `, ${METHOD_LABEL[method] ?? "how?"}` : ""}, ${shortDate(when)})` : "";
  const saves = gasOn ? `Saved as gas ${driverName || "the driver"} paid for, which the band owes ${driverName || "them"} back`
    : reimburse ? `Saved as a payout that paid back ${owed.rows.length} expense${owed.rows.length === 1 ? "" : "s"}${paidBit}`
    : reimb ? (paid ? `Saved as ${memberName || "their"} expense, paid back${paidBit}` : `Saved as ${memberName ? `${memberName}'s` : "their"} expense, which the band owes ${memberName || "them"} back`)
    : expense ? (paid ? `Saved as an expense paid by ${payerName || "an admin"}${payBack ? `, which the band owes ${payerName || "them"} back` : ""}${paidBit}` : "Saved as a bill the band still owes")
    : paid ? `Saved as a paid payout${paidBit}` : "Saved as a payout, still owed";

  async function submit(e: React.FormEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!canSave || !cents) return;
    const receipt = link.trim() ? { receipt: { driveFileId: fileIdOf(link.trim()), url: link.trim() } } : {};
    if (gasOn) {
      // The member page's gas expense, logged for the driver: always paid back.
      if (!(await call("expenses.add", {
        amount: cents, what: whatText, category: "gas", projectId: ps.projectId, userId: gas.driverId, payBack: true, date: when,
        ...(ps.showId ? { showId: ps.showId } : {}), ...rehearsal, ...track, ...receipt, ...gas.payload(cents),
      }))) return;
    } else if (reimburse) {
      if (!(await call("expenses.payPerson", { userId: reimbUser, ids: owed.rows.map((x) => x.id), method, paidAt: when, paidBy: payer }))) return;
    } else if (reimb) {
      // The same record a member logs for themselves: they paid, pay-back on. We paid also settles it right away.
      const r = await call("expenses.add", {
        amount: cents, what: whatText, category, projectId: ps.projectId, userId: member, payBack: true, date: when,
        ...(to ? { to: to.to } : {}), ...(ps.showId ? { showId: ps.showId } : {}), ...rehearsal, ...track, ...receipt,
      });
      if (!r?.id) return;
      if (paid && !(await call("expenses.payPerson", { userId: member, ids: [r.id], method, paidAt: when, paidBy: payer }))) return;
    } else if (expense) {
      if (!(await call("expenses.add", {
        amount: cents, what: whatText, category, projectId: ps.projectId, to: to!.to, ...(ps.showId ? { showId: ps.showId } : {}), ...rehearsal, ...track, ...receipt,
        ...(paid ? { userId: payer, date: when, payBack } : { owed: true }),
      }))) return;
    } else {
      if (!(await call("payouts.add", {
        to: to!.to, kind, amount: cents, projectId: ps.projectId, ...(whatText ? { what: whatText } : {}), ...(ps.showId ? { showId: ps.showId } : {}), ...rehearsal, ...track,
        ...(paid ? { method, paidAt: when, paidBy: payer } : {}),
      }))) return;
    }
    onClose();
  }

  return (
    <form onSubmit={submit} data-testid="money-out-form">
      <ModalHead title="Money out" onClose={onClose} testid="mo-close" />
      <div className="grid gap-[16px]" style={{ padding: "18px 22px" }}>
        {!reimburse && !gasOn && <Toggle name="mo-status" value={paid ? "b" : "a"} a="We owe" b="We paid" onChange={(v) => setPaid(v === "b")} testidA="mo-owe" testidB="mo-paid" />}
        {!reimburse && (
          <div className="grid gap-[14px] sm:grid-cols-2">
            {!gasOn && <label className="grid gap-1">
              <span className="lbl">What kind</span>
              <Select<Kind> value={kind} options={KINDS} onChange={setKind} testid="mo-kind" />
            </label>}
            {(expense || reimb) && <CategoryField value={category} options={CATEGORIES} onChange={setCategory} testid="mo-cat" />}
          </div>
        )}
        {gasOn && <GasFields g={gas} testid="mo-gas" />}
        {!reimburse && reimb && !gasOn && (
          <label className="grid gap-1">
            <span className="lbl">Who paid</span>
            <select className="select" value={member} onChange={(e) => setMember(e.target.value)} data-testid="mo-member">
              <option value="">Pick a bandmate</option>
              {bandUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        )}
        {reimburse ? (
          <div className="grid gap-1" data-testid="mo-expenses">
            <span className="lbl">Paying {personName || "them"} back for</span>
            {owed.rows.map((x) => (
              <div key={x.id} className="flex justify-between gap-3" data-testid={`mo-expense-${x.id}`}><span>{x.what}</span><span className="font-bold">{formatCents(x.amount)}</span></div>
            ))}
          </div>
        ) : (
          <>
            {!gasOn && <div className="grid gap-1">
              <span className="lbl">{reimb ? <>To <span className="font-normal">(optional)</span></> : "To"}</span>
              <WhoPicker options={options} value={to} onChange={(v) => { setTouchedWho(true); setWho(v); }} testid="mo-who"
                placeholder={reimb ? "The gas station, the store" : expense ? "The vendor or a bandmate" : "A bandmate or a player"} />
            </div>}
            <div className="grid gap-[14px] sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="lbl">Amount</span>
                <input className="input" inputMode="decimal" placeholder="$0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setAmountEdited(e.target.value.trim() !== ""); }} data-testid="mo-amount" />
              </label>
              <label className="grid gap-1">
                <span className="lbl">{expense || reimb || gasOn ? "What for" : <>For <span className="font-normal">(optional)</span></>}</span>
                <input className="input" type="text" value={what} placeholder={gasOn ? "Gas" : undefined} onChange={(e) => setWhat(e.target.value)} data-testid="mo-what" />
              </label>
            </div>
          </>
        )}
        <ProjectShowFields s={ps} prefix="mo" context={context} />
        {!reimburse && <TrackField t={tr} prefix="mo" context={context} />}
        {(needsPayer || reimb || gasOn) && (
          <div className="grid gap-[14px] sm:grid-cols-2">
            {gasOn ? <span /> : needsPayer ? <PayerField admins={admins} value={payer} onChange={setPayer} testid="mo-payer" label={reimb ? "Paid back by" : undefined} /> : <span />}
            <label className="grid gap-1">
              <span className="lbl">When</span>
              <input className="input" type="date" value={when} onChange={(e) => setWhen(e.target.value)} data-testid="mo-when" />
            </label>
          </div>
        )}
        {needsMethod && (
          <label className="grid gap-1">
            <span className="lbl">How</span>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value)} data-testid="mo-method">
              <option value="">Pick one</option>
              {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
        {paid && expense && !reimburse && !gasOn && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={payBack} onChange={(e) => setPayBack(e.target.checked)} data-testid="mo-payback" />
            <span>The band owes {payerName || "the payer"} this back</span>
          </label>
        )}
        {!reimburse && (expense || reimb) && (showLink ? (
          <label className="grid gap-1">
            <span className="lbl">Receipt <span className="font-normal">(Drive link)</span></span>
            <input className="input" placeholder="Paste a Drive link" value={link} onChange={(e) => setLink(e.target.value)} data-testid="mo-receipt" />
          </label>
        ) : (
          <button type="button" className="s justify-self-start border-0 bg-transparent p-0 underline" onClick={() => setShowLink(true)} data-testid="mo-add-receipt">Add receipt</button>
        ))}
      </div>
      <ModalFoot sentence={sentence} saves={saves} error={error} busy={busy} canSave={canSave} onCancel={onClose} prefix="mo" />
    </form>
  );
}

/** Settling one thing we owe: who paid (an admin), when (today unless changed), and for a payout how. */
function MarkPaidForm({ onClose, target }: { onClose(): void; target: { kind: "expense" | "payout"; id: string } }) {
  const { call, error, busy } = useCommand();
  const me = useProfile();
  const users = useCollection<User>("users");
  const admins = useAdmins(users.rows ?? []);
  const expense = useDocs<Expense>("expenses", [target.id], { skip: target.kind !== "expense" });
  const payout = useDocs<Payout>("payouts", [target.id], { skip: target.kind !== "payout" });
  const [payer, setPayer] = useState(me.role === "admin" ? me.uid : "");
  const [when, setWhen] = useState(dateInBandZone());
  const [method, setMethod] = useState("");
  const rec = target.kind === "expense" ? expense.rows[0] : payout.rows[0];
  const toName = target.kind === "expense" ? expense.rows[0]?.to?.name ?? expense.rows[0]?.what ?? "" : payout.rows[0]?.to.name ?? "";
  const payerName = (users.rows ?? []).find((u) => u.id === payer)?.name ?? "";
  const canSave = !!rec && !!payer && !!when && (target.kind === "expense" || !!method);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!canSave) return;
    const ok = target.kind === "expense"
      ? await call("expenses.markPaid", { id: target.id, userId: payer, paidAt: when })
      : await call("payouts.markPaid", { id: target.id, paidAt: when, method, paidBy: payer });
    if (ok) onClose();
  }
  return (
    <form onSubmit={submit} data-testid="mark-paid-form">
      <ModalHead title="Mark paid" sub={rec ? `${toName} · ${formatCents(rec.amount)}` : undefined} onClose={onClose} testid="mp-close" />
      <div className="grid gap-[16px]" style={{ padding: "18px 22px" }}>
        <div className="grid gap-[14px] sm:grid-cols-2">
          <PayerField admins={admins} value={payer} onChange={setPayer} testid="mp-payer" />
          <label className="grid gap-1">
            <span className="lbl">When</span>
            <input className="input" type="date" value={when} onChange={(e) => setWhen(e.target.value)} data-testid="mp-when" />
          </label>
        </div>
        {target.kind === "payout" && (
          <label className="grid gap-1">
            <span className="lbl">How</span>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value)} data-testid="mp-method">
              <option value="">Pick one</option>
              {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
      </div>
      <ModalFoot sentence={`${payerName || "Someone"} paid ${toName || "them"} ${rec ? formatCents(rec.amount) : ""}`} saves={`Marked paid on ${shortDate(when)}${target.kind === "payout" && method ? ` by ${METHOD_LABEL[method]}` : ""}`}
        error={error} busy={busy} canSave={canSave} onCancel={onClose} prefix="mp" />
    </form>
  );
}


// ---- Editing an existing line (defaults.edit): autosave per field, one Done ----

/** Autosaving updates for one record: save({ field }) sends `{ id, patch }` to the update command; status and error feed the footer. */
export function useEditSave(command: string, id: string) {
  const s = useInstantSave();
  const [bad, setBad] = useState<string | null>(null);
  return { status: s.status, error: s.error, bad, setBad, save: (patch: Record<string, unknown>, what: string) => s.save(command, { id, patch }, what) };
}

/** A text/date/amount box that saves when you leave it (or press Enter). `onCommit` returns false to put the old value back. */
export function EditInput({ label, value, onCommit, testid, type = "text", inputMode, placeholder }: {
  label: React.ReactNode; value: string; onCommit(v: string): boolean | Promise<boolean>; testid: string; type?: "text" | "date"; inputMode?: "decimal"; placeholder?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  async function commit() { if (v.trim() === value.trim()) return; if (!(await onCommit(v))) setV(value); }
  return (
    <label className="grid gap-1">
      <span className="lbl">{label}</span>
      <input className="input" type={type} inputMode={inputMode} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => void commit()}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} data-testid={testid} />
    </label>
  );
}

/** The amount box of an edit: dollars shown, cents saved. */
export function EditAmount({ cents, onSave, setBad, testid }: { cents: number; onSave(c: number): void; setBad(m: string | null): void; testid: string }) {
  return (
    <EditInput label="Amount" value={(cents / 100).toFixed(2)} inputMode="decimal" testid={testid}
      onCommit={(v) => { const c = parseDollars(v); if (!c || c <= 0) { setBad("Enter an amount like 12.50."); return false; } setBad(null); onSave(c); return true; }} />
  );
}

/** Project, Show and Track pickers whose changes save straight to the record (a new project also drops the old project's track). */
export function useEditPickers(doc: { projectId?: string; showId?: string; releaseTrackId?: string }, save: (patch: Record<string, unknown>, what: string) => unknown) {
  const ps = useProjectsAndShows({ projectId: doc.projectId, showId: doc.showId });
  const tr = useReleaseTracks(ps.projectId, { releaseTrackId: doc.releaseTrackId });
  const s = { ...ps, setProjectPick: (v: string) => { ps.setProjectPick(v); void save({ projectId: v, ...(doc.releaseTrackId ? { releaseTrackId: null } : {}) }, "the project"); }, setShowId: (v: string) => { ps.setShowId(v); void save({ showId: v || null }, "the show"); } } as typeof ps;
  const t = { ...tr, setTrackId: (v: string) => { tr.setTrackId(v); void save({ releaseTrackId: v || null }, "the track"); } } as typeof tr;
  return { s, t };
}

/** The footer of an edit: save state, a validation message, and the one Done button. */
export function EditFoot({ prefix, status, error, bad, onClose }: { prefix: string; status: Parameters<typeof PanelStatus>[0]["status"]; error: string | null; bad: string | null; onClose(): void }) {
  return (
    <>
      <div style={{ padding: "0 22px" }}><ErrorBox error={bad} /></div>
      <div className="flex flex-wrap items-center justify-end gap-[10px] border-t border-divider" style={{ padding: "14px 22px 20px" }}>
        <PanelStatus status={status} error={error} />
        <button type="button" className="btn acc" onClick={onClose} data-testid={`${prefix}-done`}>Done</button>
      </div>
    </>
  );
}

const toOption = (to: NonNullable<Expense["to"]>): WhoOption =>
  "userId" in to ? { key: `u:${to.userId}`, name: to.name, to: { userId: to.userId } }
  : "musicianId" in to ? { key: `m:${to.musicianId}`, name: to.name, to: { musicianId: to.musicianId } }
  : "contactId" in to ? { key: `c:${to.contactId}`, name: to.name, to: { contactId: to.contactId } }
  : { key: `n:${to.name}`, name: to.name, to: { name: to.name } };

/** The To options and the name list the edit forms share. */
function useEditWho() {
  const users = useCollection<User>("users");
  const musicians = useCollection<Musician>("musicians");
  const expensesAll = useCollection<Expense>("expenses");
  const payoutsAll = useCollection<Payout>("payouts");
  const priorNames = useMemo(() => [...new Set([...(expensesAll.rows ?? []).map((x) => x.to?.name), ...(payoutsAll.rows ?? []).map((p) => p.to.name)].filter((n): n is string => !!n))], [expensesAll.rows, payoutsAll.rows]);
  const options = useWhoOptions({ users: users.rows ?? [], musicians: musicians.rows ?? [], contacts: [], priorNames });
  return { users: users.rows ?? [], options };
}

function ExpenseEdit({ id, context, onClose }: { id: string; context?: MoneyDefaults["context"]; onClose(): void }) {
  const { doc } = useDoc<Expense>("expenses", id);
  return doc ? <ExpenseEditBody x={doc} context={context} onClose={onClose} /> : <div style={{ padding: 22 }} data-testid="mo-edit-loading">Loading…</div>;
}

function ExpenseEditBody({ x, context, onClose }: { x: Row<Expense>; context?: MoneyDefaults["context"]; onClose(): void }) {
  const { save, status, error, bad, setBad } = useEditSave("expenses.update", x.id);
  const { users, options } = useEditWho();
  const bandUsers = useBandUsers(users);
  const { s, t } = useEditPickers(x, save);
  const [who, setWho] = useState<WhoOption | null>(x.to ? toOption(x.to) : null);
  const bill = x.owed === true;
  const gas = x.category === "gas" || !!x.gas;
  const locked = !!x.paidBackAt;
  const payer = users.find((u) => u.id === x.userId)?.name ?? "the payer";
  return (
    <div data-testid="money-out-edit">
      <ModalHead title="Money out" sub={locked ? undefined : "Changes save as you go"} onClose={onClose} testid="mo-close" />
      <fieldset disabled={locked} className="grid gap-[16px] border-0 p-0 m-0 min-w-0" style={{ padding: "18px 22px" }}>
        {locked && <p className="m-0 font-bold" data-testid="mo-locked">Paid back on {shortDate(x.paidBackAt!)}, so it can&apos;t be changed.</p>}
        <div className="grid gap-[14px] sm:grid-cols-2">
          <EditAmount cents={x.amount} setBad={setBad} testid="mo-amount" onSave={(amount) => void save({ amount }, "the amount")} />
          <EditInput label="What for" value={x.what} testid="mo-what" onCommit={(v) => { if (!v.trim()) { setBad("What for can't be empty."); return false; } setBad(null); void save({ what: v.trim() }, "what for"); return true; }} />
        </div>
        {!gas && (
          <div className="grid gap-[14px] sm:grid-cols-2">
            <CategoryField value={x.category} options={CATEGORIES} onChange={(category) => void save({ category }, "the category")} testid="mo-cat" />
            <div className="grid gap-1">
              <span className="lbl">To</span>
              <WhoPicker options={options} value={who} onChange={(v) => { setWho(v); if (v) void save({ to: v.to }, "who was paid"); }} testid="mo-who" placeholder="The vendor or a bandmate" />
            </div>
          </div>
        )}
        {!bill && (
          <div className="grid gap-[14px] sm:grid-cols-2">
            {gas ? <span /> : (
              <label className="grid gap-1">
                <span className="lbl">Who paid</span>
                <select className="select" value={x.userId} onChange={(e) => void save({ userId: e.target.value }, "who paid")} data-testid="mo-member">
                  {bandUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
            )}
            <EditInput label="When" type="date" value={x.date} testid="mo-when" onCommit={(v) => { if (!v) return false; void save({ date: v }, "the date"); return true; }} />
          </div>
        )}
        {!gas && !bill && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={x.payBack !== false} onChange={(e) => void save({ payBack: e.target.checked }, "pay back")} data-testid="mo-payback" />
            <span>The band owes {payer} this back</span>
          </label>
        )}
        {!gas && <ProjectShowFields s={s} prefix="mo" context={context} />}
        {!gas && <TrackField t={t} prefix="mo" context={context} />}
        <EditInput label={<>Receipt <span className="font-normal">(Drive link)</span></>} value={x.receipt?.url ?? ""} testid="mo-receipt" placeholder="Paste a Drive link"
          onCommit={(v) => { const link = v.trim(); if (link) void save({ receipt: { driveFileId: fileIdOf(link), url: link } }, "the receipt"); else void save({ receipt: null }, "the receipt"); return true; }} />
      </fieldset>
      <EditFoot prefix="mo" status={status} error={error} bad={bad} onClose={onClose} />
    </div>
  );
}

const PAY_KINDS: [string, string][] = [["pay", PAYOUT_KIND_LABEL.pay], ["split", PAYOUT_KIND_LABEL.split], ["other", PAYOUT_KIND_LABEL.other]];

function PayoutEdit({ id, context, onClose }: { id: string; context?: MoneyDefaults["context"]; onClose(): void }) {
  const { doc } = useDoc<Payout>("payouts", id);
  return doc ? <PayoutEditBody x={doc} context={context} onClose={onClose} /> : <div style={{ padding: 22 }} data-testid="mo-edit-loading">Loading…</div>;
}

function PayoutEditBody({ x, context, onClose }: { x: Row<Payout>; context?: MoneyDefaults["context"]; onClose(): void }) {
  const { save, status, error, bad, setBad } = useEditSave("payouts.update", x.id);
  const { users, options } = useEditWho();
  const admins = useAdmins(users);
  const { s, t } = useEditPickers(x, save);
  const [who, setWho] = useState<WhoOption | null>(toOption(x.to));
  const kinds = PAY_KINDS.some(([k]) => k === x.kind) ? PAY_KINDS : [...PAY_KINDS, [x.kind, PAYOUT_KIND_LABEL[x.kind] ?? x.kind] as [string, string]];
  return (
    <div data-testid="money-out-edit">
      <ModalHead title="Money out" sub="Changes save as you go" onClose={onClose} testid="mo-close" />
      <div className="grid gap-[16px]" style={{ padding: "18px 22px" }}>
        <div className="grid gap-[14px] sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="lbl">What kind</span>
            <Select value={x.kind} options={kinds} onChange={(kind) => void save({ kind }, "the kind")} testid="mo-kind" />
          </label>
          <div className="grid gap-1">
            <span className="lbl">To</span>
            <WhoPicker options={options} value={who} onChange={(v) => { setWho(v); if (v) void save({ to: v.to }, "who it went to"); }} testid="mo-who" placeholder="A bandmate or a player" />
          </div>
        </div>
        <div className="grid gap-[14px] sm:grid-cols-2">
          <EditAmount cents={x.amount} setBad={setBad} testid="mo-amount" onSave={(amount) => void save({ amount }, "the amount")} />
          <EditInput label={<>For <span className="font-normal">(optional)</span></>} value={x.what ?? ""} testid="mo-what" onCommit={(v) => { void save({ what: v.trim() || null }, "what for"); return true; }} />
        </div>
        <ProjectShowFields s={s} prefix="mo" context={context} />
        <TrackField t={t} prefix="mo" context={context} />
        {x.paidAt && (
          <>
            <div className="grid gap-[14px] sm:grid-cols-2">
              <PayerField admins={admins} value={x.paidBy ?? ""} onChange={(v) => { if (v) void save({ paidBy: v }, "who paid"); }} testid="mo-payer" />
              <EditInput label="When" type="date" value={x.paidAt} testid="mo-when" onCommit={(v) => { if (!v) return false; void save({ paidAt: v }, "the date"); return true; }} />
            </div>
            <label className="grid gap-1">
              <span className="lbl">How</span>
              <select className="select" value={x.method ?? ""} onChange={(e) => { if (e.target.value) void save({ method: e.target.value }, "how"); }} data-testid="mo-method">
                <option value="">Pick one</option>
                {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </>
        )}
      </div>
      <EditFoot prefix="mo" status={status} error={error} bad={bad} onClose={onClose} />
    </div>
  );
}
