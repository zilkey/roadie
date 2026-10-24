"use client";
import Link from "@/lib/artist";
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { CopyButton } from "@/components/booking/common";
import { useProfile } from "@/lib/auth";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { todayStr } from "@/lib/booking";
import { addDays, checklistCount, checklistsOf, fmtDur, fmtLong, fmtTime, openItemsFor, planHome, type Answer, showName, showCity, showAddress } from "@/lib/shows";
import { Times, billingName, configName, useBand, type ShowRow } from "./common";
import type { Availability, Contact, ShowDeal } from "@/schema";

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
  const tick = (show: ShowRow): Tick => (listId, itemId, done) => void call("shows.checkItem", { id: show.id, listId, itemId, done });

  return (
    <div className="grid gap-3" data-testid="home-shows">
      <ErrorBox error={error} />
      {plan.today.map((s) => (
        <TodayCard key={s.id} show={s} b={b} onTick={tick(s)} deal={(deals.rows ?? []).find((d) => d.id === s.id)} contacts={contacts.rows ?? []} />
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
          <NextShow next={plan.next} upcoming={plan.upcoming} b={b} onTick={plan.next ? tick(plan.next) : () => undefined} />
          {admin ? regular : <Link href="/money/expense" className="btn acc" data-testid="add-expense">Add an expense</Link>}
        </>
      )}
    </div>
  );
}

function TodayCard({ show: s, b, onTick, deal, contacts }: { show: ShowRow; b: ReturnType<typeof useBand>; onTick: Tick; deal?: Row<ShowDeal>; contacts: Row<Contact>[] }) {
  const p = useProfile();
  const sl = b.setlists.find((x) => x.id === s.setlistId);
  const people = contacts.filter((c) => deal?.contactIds.includes(c.id));
  const todo = openItemsFor(checklistsOf(s), p.musicianId);
  return (
    <div className="grid gap-3" data-testid={`today-${s.id}`}>
      <div className="card hi">
        <span className="lbl">Today</span>
        <b>{showName(s)}{showCity(s) ? ` · ${showCity(s)}` : ""}</b>
        <span className="font-mono text-sm">{[showAddress(s), configName(b.artist, s.billedAs) ?? billingName(b.artist, s.billedAs)].filter(Boolean).join(" · ")}</span>
        <Times times={s.times} />
        <Link href={`/shows/${s.id}`} className="s font-semibold underline" data-testid={`today-open-${s.id}`}>Open show ›</Link>
      </div>
      {todo.length > 0 && (
        <div className="grid gap-1.5" data-testid={`today-todo-${s.id}`}>
          <span className="lbl">To do · {todo.length}</span>
          <TodoList items={todo} onTick={onTick} />
        </div>
      )}
      {sl && (
        <div className="grid gap-1.5">
          <span className="lbl">Setlist · {fmtDur(sl.totalSec)}</span>
          <Link href={`/songs?setlist=${sl.id}`} className="card" data-testid={`today-setlist-${s.id}`}><div className="flex items-center justify-between"><b>{sl.name}</b><span className="s font-semibold">Open ›</span></div></Link>
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

type Tick = (listId: string, itemId: string, done: boolean) => void;

/** Open items across every list with tick boxes; a ticked item drops out on the next live update. */
function TodoList({ items, onTick }: { items: ReturnType<typeof openItemsFor>; onTick: Tick }) {
  return (
    <div className="grid gap-1.5">
      {items.map((it) => (
        <label key={`${it.listId}-${it.id}`} className="flex items-center gap-2 text-sm" data-testid={`home-todo-row-${it.id}`}>
          <input type="checkbox" checked={it.done} data-testid={`home-todo-${it.id}`} onChange={(e) => onTick(it.listId, it.id, e.target.checked)} />
          <span>{it.label}</span>
          <span className="s">· {it.listName}</span>
        </label>
      ))}
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

function NextShow({ next, upcoming, b, onTick }: { next?: ShowRow; upcoming: ShowRow[]; b: ReturnType<typeof useBand>; onTick: Tick }) {
  const p = useProfile();
  if (!next) return <div className="card" data-testid="no-next-show"><span className="lbl">Next show</span><span className="s">Nothing on the calendar yet.</span></div>;
  const { done, total } = checklistCount(checklistsOf(next));
  const todo = openItemsFor(checklistsOf(next), p.musicianId);
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
      {p.role === "member" && playing && todo.length > 0 && (
        <div className="grid gap-1.5" data-testid="my-todo">
          <span className="lbl">To do for {showName(next)}</span>
          <TodoList items={todo} onTick={onTick} />
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
