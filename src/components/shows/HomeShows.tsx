"use client";
import Link from "@/lib/artist";
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { CopyButton } from "@/components/booking/common";
import { useProfile } from "@/lib/auth";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { todayStr } from "@/lib/booking";
import { addDays, checklistCount, checklistsOf, fmtDur, fmtLong, fmtTime, planHome, type Answer, showName, showCity, showAddress } from "@/lib/shows";
import { Times, billingName, configName, nameOf, useBand, type ShowRow } from "./common";
import type { Availability, Contact, Musician, ShowDeal } from "@/schema";

/**
 * "How Home decides": today's shows first (one card each); then open "Can you play?" questions;
 * then a played show from the last few days (admins: until its money is entered; members: add expenses);
 * otherwise the next show plus `regular` (the booking to-dos for admins).
 */
export function HomeShows({ regular }: { regular?: React.ReactNode }) {
  const p = useProfile();
  const admin = p.role === "admin";
  const b = useBand();
  const deals = useCollection<ShowDeal>("showDeals", { skip: !admin });
  const contacts = useCollection<Contact>("contacts", { skip: !admin });
  const today = todayStr();
  const unsettled = new Set((deals.rows ?? []).filter((d) => !d.income?.length).map((d) => d.id));
  const plan = planHome({ role: p.role, musicianId: p.musicianId, shows: b.shows, asks: b.asks, today, unsettled });
  const { call, error } = useCommand();
  const pack = (show: ShowRow) => (itemId: string, packed: boolean) => {
    const list = checklistsOf(show).find((l) => l.name === "Gear");
    if (list) void call("shows.checkItem", { id: show.id, listId: list.id, itemId, done: packed });
  };

  return (
    <div className="grid gap-3" data-testid="home-shows">
      <ErrorBox error={error} />
      {plan.today.map((s) => (
        <TodayCard key={s.id} show={s} b={b} onPack={pack(s)} deal={(deals.rows ?? []).find((d) => d.id === s.id)} contacts={contacts.rows ?? []} />
      ))}
      {plan.asks.map((a) => <AskCard key={a.id} av={a} />)}
      {plan.recent.map((s) => (
        <div key={s.id} className="card hi" data-testid={`recent-${s.id}`}>
          <span className="lbl">{s.date === addDays(today, -1) ? "Last night" : fmtLong(s.date)} · {showName(s)}</span>
          {admin ? (
            <>
              <b>How&apos;d it go?</b>
              <span className="s">Enter the money</span>
              <Link href={`/shows/${s.id}?tab=finances`} className="btn acc" data-testid={`enter-money-${s.id}`}>Enter money</Link>
            </>
          ) : (
            <>
              <b>Add expenses from last night</b>
              <span className="s">Gas, strings, parking. Anything you paid for.</span>
              <Link href={`/money/expense?show=${s.id}`} className="btn acc" data-testid={`add-expenses-${s.id}`}>Add an expense</Link>
            </>
          )}
        </div>
      ))}
      {plan.today.length === 0 && !b.loading && (
        <>
          <NextShow next={plan.next} upcoming={plan.upcoming} b={b} onPack={plan.next ? pack(plan.next) : () => undefined} />
          {admin ? regular : <Link href="/money/expense" className="btn acc" data-testid="add-expense">Add an expense</Link>}
        </>
      )}
    </div>
  );
}

function TodayCard({ show: s, b, onPack, deal, contacts }: { show: ShowRow; b: ReturnType<typeof useBand>; onPack(itemId: string, packed: boolean): void; deal?: Row<ShowDeal>; contacts: Row<Contact>[] }) {
  const p = useProfile();
  const sl = b.setlists.find((x) => x.id === s.setlistId);
  const people = contacts.filter((c) => deal?.contactIds.includes(c.id));
  const gear = checklistsOf(s).find((l) => l.name === "Gear")?.items ?? [];
  const open = checklistsOf(s).filter((l) => l.name !== "Gear").flatMap((l) => l.items).filter((c) => !c.done);
  return (
    <div className="grid gap-3" data-testid={`today-${s.id}`}>
      <div className="card hi">
        <span className="lbl">Today</span>
        <b>{showName(s)}{showCity(s) ? ` · ${showCity(s)}` : ""}</b>
        <span className="font-mono text-sm">{[showAddress(s), configName(b.artist, s.billedAs) ?? billingName(b.artist, s.billedAs)].filter(Boolean).join(" · ")}</span>
        <Times times={s.times} />
        <Link href={`/shows/${s.id}`} className="s font-semibold underline" data-testid={`today-open-${s.id}`}>Open show ›</Link>
      </div>
      <div className="grid gap-1.5" data-testid={`today-gear-${s.id}`}>
        <span className="lbl">Gear · {gear.filter((g) => g.done).length} of {gear.length} packed</span>
        <GearList items={gear} musicians={b.musicians} onPack={onPack} testidPrefix="home-gear" />
      </div>
      {sl && (
        <div className="grid gap-1.5">
          <span className="lbl">Setlist · {fmtDur(sl.totalSec)}</span>
          <Link href={`/songs?setlist=${sl.id}`} className="card" data-testid={`today-setlist-${s.id}`}><div className="flex items-center justify-between"><b>{sl.name}</b><span className="s font-semibold">Open ›</span></div></Link>
        </div>
      )}
      {open.length > 0 && (
        <div className="grid gap-1" data-testid={`today-checklist-${s.id}`}>
          <span className="lbl">Checklist</span>
          {open.slice(0, 6).map((c) => <span key={c.id} className="text-sm">☐ {c.label}</span>)}
        </div>
      )}
      {p.role === "admin" && people.length > 0 && (
        <div className="grid gap-1" data-testid={`today-contact-${s.id}`}>
          <span className="lbl">Contact tonight</span>
          {people.map((c) => <div key={c.id} className="flex items-center justify-between"><b>{c.name}</b>{c.emails[0] && <CopyButton text={c.emails[0]} />}</div>)}
        </div>
      )}
    </div>
  );
}

/** Gear items (the "Gear" checklist) with packed checkboxes. Members can tick only what they bring. */
function GearList({ items, musicians, onPack, testidPrefix }: { items: { id: string; label: string; done: boolean; ownerId?: string }[]; musicians: Row<Musician>[]; onPack(itemId: string, packed: boolean): void; testidPrefix: string }) {
  const p = useProfile();
  if (!items.length) return <span className="s">No gear listed.</span>;
  return (
    <div className="grid gap-1.5">
      {items.map((g) => {
        const mine = !!p.musicianId && g.ownerId === p.musicianId;
        return (
          <label key={g.id} className={`flex items-center gap-2 text-sm ${mine ? "font-semibold" : ""}`} data-testid={`${testidPrefix}-row-${g.id}`}>
            <input type="checkbox" checked={g.done} disabled={p.role !== "admin" && !mine} data-testid={`${testidPrefix}-${g.id}`} onChange={(e) => onPack(g.id, e.target.checked)} />
            <span>{g.label}</span>
            {g.ownerId && <span className="s">· {mine ? "you" : nameOf(musicians, g.ownerId)}</span>}
          </label>
        );
      })}
    </div>
  );
}

function AskCard({ av }: { av: Row<Availability> }) {
  const { call, error, busy } = useCommand();
  const [note, setNote] = useState("");
  const answer = (a: Answer) => call("availability.answer", { id: av.id, answer: a, ...(note.trim() ? { note: note.trim() } : {}) });
  return (
    <div className="card hi" data-testid={`ask-${av.id}`}>
      <span className="lbl">Can you play?</span>
      <b>{av.label}</b>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn acc" disabled={busy} onClick={() => answer("yes")} data-testid={`ask-yes-${av.id}`}>Yes</button>
        <button className="btn ghost" disabled={busy} onClick={() => answer("no")} data-testid={`ask-no-${av.id}`}>No</button>
      </div>
      <button className="btn ghost" disabled={busy} onClick={() => answer("maybe")} data-testid={`ask-maybe-${av.id}`}>Maybe</button>
      <input className="input" placeholder="Add a note (optional)…" value={note} onChange={(e) => setNote(e.target.value)} data-testid={`ask-note-${av.id}`} />
      <ErrorBox error={error} />
    </div>
  );
}

function NextShow({ next, upcoming, b, onPack }: { next?: ShowRow; upcoming: ShowRow[]; b: ReturnType<typeof useBand>; onPack(itemId: string, packed: boolean): void }) {
  const p = useProfile();
  if (!next) return <div className="card" data-testid="no-next-show"><span className="lbl">Next show</span><span className="s">Nothing on the calendar yet.</span></div>;
  const { done, total } = checklistCount(checklistsOf(next));
  const myGear = (checklistsOf(next).find((l) => l.name === "Gear")?.items ?? []).filter((g) => g.ownerId === p.musicianId);
  const playing = !!p.musicianId && next.personnel.includes(p.musicianId);
  const rest = upcoming.filter((s) => s.id !== next.id).slice(0, 4);
  return (
    <>
      <div className="grid gap-1.5" data-testid="next-show">
        <span className="lbl">Next show</span>
        <Link href={`/shows/${next.id}`} className="card" data-testid={`next-show-${next.id}`}>
          <b>{fmtLong(next.date)} · {showName(next)}</b>
          <span className="font-mono text-sm">{[showCity(next), next.times.loadIn && `Load in ${fmtTime(next.times.loadIn)}`, next.times.set && `Set ${fmtTime(next.times.set)}`, configName(b.artist, next.billedAs)].filter(Boolean).join(" · ")}</span>
          {total > 0 && <>
            <div className="h-1.5 overflow-hidden rounded-full bg-soft"><div className="h-full bg-accent" style={{ width: `${(done / total) * 100}%` }} /></div>
            <span className="s">Checklist {done} of {total}</span>
          </>}
        </Link>
      </div>
      {p.role === "member" && playing && myGear.length > 0 && (
        <div className="grid gap-1.5" data-testid="bringing">
          <span className="lbl">You&apos;re bringing</span>
          <GearList items={myGear} musicians={b.musicians} onPack={onPack} testidPrefix="bring" />
        </div>
      )}
      {p.role === "member" && rest.length > 0 && (
        <div className="grid gap-1.5" data-testid="coming-up">
          <span className="lbl">Coming up</span>
          {rest.map((s) => (
            <Link key={s.id} href={`/shows/${s.id}`} className="card" data-testid={`coming-${s.id}`}>
              <div className="flex items-center justify-between"><b>{showName(s)}</b><span className="s">{fmtLong(s.date)}{p.musicianId && !s.personnel.includes(p.musicianId) ? " · not playing" : ""}</span></div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
