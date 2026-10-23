"use client";
import { draftPath } from "@/schema/drafts";
import { fmtInstant } from "@/lib/timezone";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { CopyButton } from "@/components/booking/common";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { formatCents, dollarsToCents } from "@/lib/money";
import { fmtDur, fmtLong, type ChecklistItem } from "@/lib/shows";
import { GearChecklist, nameOf, packedCount, type ShowRow } from "./common";
import { PanelStatus, useInstantSave } from "./saved";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useAutosave } from "@/lib/autosave";
import { useDraft } from "@/lib/drafts";
import type { Contact, Musician, Setlist, ShowDeal } from "@/schema";

const Sec = ({ title, children, testid }: { title: React.ReactNode; children: React.ReactNode; testid?: string }) => (
  <div className="grid gap-2" data-testid={testid}><span className="lbl">{title}</span>{children}</div>
);

// ---------- checklist ----------

export function ChecklistPanel({ show, musicians, editable }: { show: ShowRow; musicians: Row<Musician>[]; editable: boolean }) {
  const inst = useInstantSave();
  const busy = inst.status === "saving";
  // The "add an item" box is a draft (kept on this device and the server until the item is added).
  const add = useDraft(draftPath.newUnder("shows", show.id, "checklist"), { label: "" }, { title: (v) => `New checklist item · ${v.label || show.venue.name}` });
  const list = show.checklist as ChecklistItem[];
  const save = (next: unknown[]) => inst.save("shows.setChecklist", { id: show.id, checklist: next }, "checklist");
  const patch = (id: string, p: Partial<ChecklistItem>) => save(list.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const done = list.filter((c) => c.done).length;
  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    const label = add.value.label.trim();
    if (!label) return;
    await add.settle();
    if (await save([...list, { label, done: false }])) await add.clear({ reset: true });
  }
  return (
    <Sec title={<>{`Checklist · ${done} of ${list.length}`} <PanelStatus status={inst.status} error={inst.error} /></>} testid="checklist">
      {list.length === 0 && <span className="s">Nothing on the list.</span>}
      {list.map((c) => (
        <div key={c.id} className="grid gap-1 rounded-lg border border-line p-2" data-testid={`check-row-${c.id}`}>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.done} disabled={!editable || busy} data-testid={`check-${c.id}`} onChange={(e) => patch(c.id, { done: e.target.checked })} />
            {editable
              ? <input className="input" key={c.label} defaultValue={c.label} data-testid={`check-label-${c.id}`} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.label) patch(c.id, { label: v }); }} />
              : <span className={c.done ? "line-through opacity-60" : ""}>{c.label}</span>}
          </label>
          {editable ? (
            <div className="flex flex-wrap gap-2">
              <select className="select !w-auto" value={c.ownerId ?? ""} data-testid={`check-owner-${c.id}`} onChange={(e) => { const { ownerId: _o, ...rest } = c; void _o; save(list.map((x) => (x.id === c.id ? { ...rest, ...(e.target.value ? { ownerId: e.target.value } : {}) } : x))); }}>
                <option value="">No owner</option>
                {musicians.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <input type="date" className="input !w-auto" value={c.due ?? ""} onChange={(e) => e.target.value && patch(c.id, { due: e.target.value })} />
              <button className="btn ghost sm" onClick={() => save(list.filter((x) => x.id !== c.id))} aria-label={`Remove ${c.label}`}>Remove</button>
            </div>
          ) : (c.ownerId || c.due) && <span className="s">{[c.ownerId && nameOf(musicians, c.ownerId), c.due && `due ${fmtLong(c.due)}`].filter(Boolean).join(" · ")}</span>}
        </div>
      ))}
      {editable && (
        <>
          <form className="flex gap-2" onSubmit={addItem}>
            <input className="input" placeholder="Add an item…" value={add.value.label} disabled={!add.ready} onChange={(e) => add.setValue({ label: e.target.value })} data-testid="check-add" />
            <button className="btn ghost" disabled={busy || !add.ready || !add.value.label.trim()} data-testid="check-add-btn">Add</button>
          </form>
          <DraftNote restoredAt={add.restoredAt} status={add.status} onStartOver={() => void add.clear({ reset: true })} />
        </>
      )}
    </Sec>
  );
}

// ---------- gear ----------

export function GearPanel({ show, musicians, editable }: { show: ShowRow; musicians: Row<Musician>[]; editable: boolean }) {
  const { call, error: callError, busy: callBusy } = useCommand();
  const inst = useInstantSave();
  const busy = callBusy || inst.status === "saving";
  const add = useDraft(draftPath.newUnder("shows", show.id, "gear"), { label: "", owner: "" }, { title: (v) => `New gear · ${v.label || show.venue.name}` });
  const pack = (itemId: string, packed: boolean) => inst.save("shows.packGear", { id: show.id, itemId, packed }, "gear");
  const save = (gear: unknown[]) => inst.save("shows.setGear", { id: show.id, gear }, "gear");
  async function addGear(e: React.FormEvent) {
    e.preventDefault();
    const { label, owner } = add.value;
    if (!label.trim()) return;
    await add.settle();
    if (await save([...show.gear, { label: label.trim(), ...(owner ? { musicianId: owner } : {}), packed: false }])) await add.clear({ reset: true });
  }
  return (
    <Sec title={<>{`Gear · ${packedCount(show)}`} <PanelStatus status={inst.status} error={inst.error} /></>} testid="gear">
      {!editable && <GearChecklist show={show} musicians={musicians} onPack={pack} />}
      {editable && show.gear.map((g) => (
        <div key={g.id} className="flex flex-wrap items-center gap-2" data-testid={`gear-row-${g.id}`}>
          <input type="checkbox" checked={g.packed} data-testid={`gear-${g.id}`} onChange={(e) => pack(g.id, e.target.checked)} aria-label={`${g.label} packed`} />
          <input className="input !w-auto min-w-0 flex-1" key={g.label} defaultValue={g.label} data-testid={`gear-label-${g.id}`}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== g.label) save(show.gear.map((x) => (x.id === g.id ? { ...x, label: v } : x))); }} />
          <select className="select !w-auto" value={g.musicianId ?? ""} data-testid={`gear-owner-${g.id}`}
            onChange={(e) => save(show.gear.map((x) => { if (x.id !== g.id) return x; const { musicianId: _m, ...rest } = x; void _m; return e.target.value ? { ...rest, musicianId: e.target.value } : rest; }))}>
            <option value="">No one</option>
            {musicians.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button className="btn ghost sm" onClick={() => save(show.gear.filter((x) => x.id !== g.id))} aria-label={`Remove ${g.label}`}>Remove</button>
        </div>
      ))}
      {show.gear.length === 0 && editable && <span className="s">No gear yet. Pick &ldquo;Billed as&rdquo; or add some.</span>}
      {editable && (
        <>
          <form className="flex flex-wrap gap-2" onSubmit={addGear}>
            <input className="input !w-auto min-w-0 flex-1" placeholder="Add gear…" value={add.value.label} disabled={!add.ready} onChange={(e) => add.setValue({ ...add.value, label: e.target.value })} data-testid="gear-add" />
            <select className="select !w-auto" value={add.value.owner} disabled={!add.ready} onChange={(e) => add.setValue({ ...add.value, owner: e.target.value })} data-testid="gear-add-owner">
              <option value="">Who brings it</option>
              {musicians.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button className="btn ghost" disabled={busy || !add.ready || !add.value.label.trim()} data-testid="gear-add-btn">Add</button>
          </form>
          <DraftNote restoredAt={add.restoredAt} status={add.status} onStartOver={() => void add.clear({ reset: true })} />
          <div className="flex items-center gap-2">
            <button className="btn ghost sm" disabled={busy} onClick={() => confirm("Rebuild the gear list from Billed as and sound? Your edits to the list are replaced.") && call("shows.update", { id: show.id, patch: { rebuildGear: true } })} data-testid="gear-rebuild">Rebuild from billed as + sound</button>
            <span className="s">Built from {show.billedAs ? "the configuration" : "sound only"} and who provides sound.</span>
          </div>
        </>
      )}
      <ErrorBox error={callError} />
    </Sec>
  );
}

// ---------- setlist, docs ----------

export function SetlistPanel({ show, setlists, editable }: { show: ShowRow; setlists: Row<Setlist>[]; editable: boolean }) {
  const { call, error } = useCommand();
  const sl = setlists.find((s) => s.id === show.setlistId);
  const songs = sl?.items.filter((i) => i.type === "song").length ?? 0;
  return (
    <Sec title={`Setlist${sl ? ` · ${fmtDur(sl.totalSec)}` : ""}`} testid="setlist">
      {sl ? (
        <Link href={`/songs?setlist=${sl.id}`} className="card" data-testid="setlist-link">
          <div className="flex items-center justify-between"><b>{sl.name}</b><span className="s font-semibold">Open ›</span></div>
          <span className="s">{songs} songs</span>
        </Link>
      ) : <span className="s">No setlist yet.</span>}
      {editable && (
        <select className="select" value={show.setlistId ?? ""} data-testid="setlist-select" onChange={(e) => call("setlists.attach", { showId: show.id, setlistId: e.target.value || null })}>
          <option value="">No setlist</option>
          {setlists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <ErrorBox error={error} />
    </Sec>
  );
}

export function DocsPanel({ show, editable }: { show: ShowRow; editable: boolean }) {
  const inst = useInstantSave();
  const busy = inst.status === "saving";
  const add = useDraft(draftPath.newUnder("shows", show.id, "docs"), { title: "", url: "" }, { title: (v) => `New doc · ${v.title || show.venue.name}` });
  const saveDocs = (docs: unknown[]) => inst.save("shows.update", { id: show.id, patch: { docs } }, "docs");
  async function addDoc(e: React.FormEvent) {
    e.preventDefault();
    await add.settle();
    if (await saveDocs([...show.docs, { title: add.value.title.trim(), driveFileId: "", url: add.value.url.trim() }])) await add.clear({ reset: true });
  }
  if (!show.docs.length && !editable) return null;
  return (
    <Sec title={<>Docs <PanelStatus status={inst.status} error={inst.error} /></>} testid="docs">
      {show.docs.map((d, i) => (
        <div key={d.url + i} className="flex items-center justify-between gap-2">
          <a href={d.url} target="_blank" rel="noreferrer" className="font-semibold underline">{d.title}</a>
          {editable && <button className="btn ghost sm" disabled={busy} onClick={() => saveDocs(show.docs.filter((_, j) => j !== i))}>Remove</button>}
        </div>
      ))}
      {show.docs.length === 0 && <span className="s">Stage plot, poster, etc.</span>}
      {editable && (
        <>
          <form className="flex flex-wrap gap-2" onSubmit={addDoc}>
            <input className="input !w-auto min-w-0 flex-1" placeholder="Title" value={add.value.title} disabled={!add.ready} onChange={(e) => add.setValue({ ...add.value, title: e.target.value })} data-testid="doc-title" />
            <input className="input !w-auto min-w-0 flex-1" placeholder="Link" type="url" value={add.value.url} disabled={!add.ready} onChange={(e) => add.setValue({ ...add.value, url: e.target.value })} data-testid="doc-url" />
            <button className="btn ghost" disabled={busy || !add.ready || !add.value.title.trim() || !add.value.url.trim()} data-testid="doc-add">Add</button>
          </form>
          <DraftNote restoredAt={add.restoredAt} status={add.status} onStartOver={() => void add.clear({ reset: true })} />
        </>
      )}
    </Sec>
  );
}

// ---------- calendar and Bandsintown ----------

export function ListingsPanel({ show, editable }: { show: ShowRow; editable: boolean }) {
  const { call, error, busy } = useCommand();
  const bit = show.listings.bandsintown;
  const eligible = show.public && show.status === "confirmed";
  const when = bit?.syncedAt ? fmtInstant(bit.syncedAt) : "";
  const [warn, setWarn] = useState<string[]>([]);
  async function sync() { const r = await call<{ warnings: string[] }>("shows.sync", { id: show.id }); if (r) setWarn(r.warnings); }
  return (
    <Sec title="Listings" testid="listings">
      <div className="card">
        <div className="flex items-center justify-between gap-2">
          <b>Bandsintown</b>
          <span className={`chip ${bit?.state === "listed" ? "g" : bit?.state === "error" ? "a" : ""}`} data-testid="bit-state">
            {bit?.state === "listed" ? "Listed" : bit?.state === "error" ? "Error" : bit?.state === "pending" ? "Pending" : "Not listed"}
          </span>
        </div>
        <span className="s" data-testid="bit-detail">
          {bit?.state === "listed" && `Last synced ${when}`}
          {bit?.state === "error" && `${bit.error ?? "Sync failed"}${when ? ` · ${when}` : ""}`}
          {!bit && (eligible ? "Waiting to sync." : show.status === "hold" ? "Holds stay off Bandsintown." : !show.public ? "Private shows stay off Bandsintown." : "Only confirmed public shows are listed.")}
        </span>
        <div className="flex items-center justify-between gap-2">
          <b>Google Calendar</b>
          <span className={`chip ${show.calendarEventId ? "g" : ""}`} data-testid="cal-state">{show.calendarEventId ? "On calendar" : "Not on calendar"}</span>
        </div>
        {editable && show.status !== "canceled" && (
          <div className="flex flex-wrap gap-2">
            {eligible && <button className="btn ghost sm" disabled={busy} onClick={sync} data-testid="bit-sync">Sync Bandsintown now</button>}
            <button className="btn ghost sm" disabled={busy} data-testid="cal-toggle"
              onClick={async () => { const r = await call<{ warnings: string[] }>("shows.calendar", { id: show.id, on: !show.calendarEventId }); if (r) setWarn(r.warnings); }}>
              {show.calendarEventId ? "Take off calendar" : "Add to everyone's calendar"}
            </button>
          </div>
        )}
        {warn.map((w) => <span key={w} className="s text-warn">{w}</span>)}
        <ErrorBox error={error} />
      </div>
    </Sec>
  );
}

// ---------- admin-only: deal ----------

const DEAL_LABEL = { guarantee: "Guarantee", doorSplit: "Door split", flat: "Flat fee", tips: "Tips", free: "Free" } as const;
export function dealSummary(d: Pick<ShowDeal, "deal" | "guarantee" | "doorSplitPct" | "ticketPrice">) {
  if (d.deal === "guarantee") return d.guarantee != null ? `${formatCents(d.guarantee)} guarantee` : "Guarantee";
  if (d.deal === "doorSplit") return `${d.doorSplitPct ?? "?"}% of the door${d.ticketPrice ? ` at ${formatCents(d.ticketPrice)}` : ""}`;
  return DEAL_LABEL[d.deal];
}

/** Only rendered for admins: reads showDeals and contacts, which the rules hide from members. */
export function DealPanel({ show }: { show: ShowRow }) {
  const deal = useDoc<ShowDeal>("showDeals", show.id).doc;
  const contacts = useCollection<Contact>("contacts").rows ?? [];
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState<{ deal: ShowDeal["deal"]; guarantee: string; pct: string; ticket: string } | null>(null);
  // Existing record = autosave: each change is a patch through showDeals.update, with status and Undo.
  const as = useAutosave({ command: "showDeals.update", id: show.id, rev: deal?.rev, onUseTheirs: () => setF(null) });
  const serverKey = JSON.stringify([deal?.deal, deal?.guarantee, deal?.doorSplitPct, deal?.ticketPrice]);
  // Keep the form in step with the record when it changes under us (Undo, someone else), unless we have unsaved edits.
  useEffect(() => { if (!as.isBusy()) setF(null); }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!deal) return null;
  const form = f ?? { deal: deal.deal, guarantee: deal.guarantee != null ? String(deal.guarantee / 100) : "", pct: deal.doorSplitPct != null ? String(deal.doorSplitPct) : "", ticket: deal.ticketPrice != null ? String(deal.ticketPrice / 100) : "" };
  const people = contacts.filter((c) => deal.contactIds.includes(c.id));
  const rating = deal.rating;
  type DealForm = typeof form;
  const dealPatch = (a: DealForm, b: DealForm) => {
    const pa = valuesOf(a), pb = valuesOf(b);
    return Object.fromEntries(Object.entries(pb).filter(([k, v]) => v !== pa[k as keyof typeof pa]));
  };
  const valuesOf = (x: DealForm) => ({
    deal: x.deal, guarantee: x.deal === "guarantee" && x.guarantee ? dollarsToCents(x.guarantee) : null,
    doorSplitPct: x.deal === "doorSplit" && x.pct ? Number(x.pct) : null, ticketPrice: x.deal === "doorSplit" && x.ticket ? dollarsToCents(x.ticket) : null,
  });
  const change = (next: DealForm) => { as.patch(dealPatch(form, next)); setF(next); };
  return (
    <div className="card hi" data-testid="deal-panel">
      <span className="s font-semibold">Only admins see this</span>
      <div className="flex justify-between gap-2"><span>Deal</span><b data-testid="deal-summary">{dealSummary(deal)}</b></div>
      <div className="flex justify-between gap-2"><span>Day-of contact</span>
        <span className="grid justify-items-end gap-1">{people.length ? people.map((c) => (
          <span key={c.id} className="flex items-center gap-2"><b>{c.name}</b>{c.emails[0] && <CopyButton text={c.emails[0]} />}</span>
        )) : <b>None</b>}</span></div>
      {deal.pitchId && <div className="flex justify-between gap-2"><span>From pitch</span><Link href={`/booking/pitches/${deal.pitchId}`} className="font-semibold underline">Open ›</Link></div>}
      {rating && (
        <div className="grid gap-0.5" data-testid="rating-summary">
          <div className="flex justify-between"><span>Show</span><b>{"★".repeat(rating.show)}{"☆".repeat(5 - rating.show)}</b></div>
          <div className="flex justify-between"><span>Venue</span><b>{"★".repeat(rating.venue)}{"☆".repeat(5 - rating.venue)}</b></div>
          {(rating.crowd != null || deal.paidAttendance != null) && <span className="s">{[rating.crowd != null && `Crowd about ${rating.crowd}`, deal.paidAttendance != null && `${deal.paidAttendance} paid`].filter(Boolean).join(" · ")}</span>}
          {rating.notes && <span className="s">{rating.notes}</span>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn ghost sm" onClick={() => { void as.flush(); setF(null); setEdit(!edit); }} data-testid="deal-edit">{edit ? "Done" : "Edit deal"}</button>
        <PanelStatus {...as.statusProps} />
        <Link href={`/shows/${show.id}/after`} className="btn sm" data-testid="after-show">After the show</Link>
      </div>
      {edit && (
        <div className="grid gap-2" data-testid="deal-form">
          <select className="select" value={form.deal} onChange={(e) => change({ ...form, deal: e.target.value as ShowDeal["deal"] })} onBlur={() => void as.flush()} data-testid="deal-edit-type">
            {Object.entries(DEAL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {form.deal === "guarantee" && <input className="input" type="number" placeholder="Guarantee ($)" value={form.guarantee} onChange={(e) => change({ ...form, guarantee: e.target.value })} onBlur={() => void as.flush()} data-testid="deal-edit-guarantee" />}
          {form.deal === "doorSplit" && <>
            <input className="input" type="number" placeholder="Our share (%)" value={form.pct} onChange={(e) => change({ ...form, pct: e.target.value })} onBlur={() => void as.flush()} data-testid="deal-edit-pct" />
            <input className="input" type="number" placeholder="Ticket price ($)" value={form.ticket} onChange={(e) => change({ ...form, ticket: e.target.value })} onBlur={() => void as.flush()} data-testid="deal-edit-ticket" />
          </>}
        </div>
      )}
    </div>
  );
}
