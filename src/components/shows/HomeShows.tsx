"use client";
import Link from "next/link";
import { useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { CopyButton } from "@/components/booking/common";
import { useProfile } from "@/lib/auth";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { todayStr } from "@/lib/booking";
import { addDays, fmtDur, fmtLong, fmtTime, planHome, type Answer } from "@/lib/shows";
import { GearChecklist, Times, billingName, configName, packedCount, useBand, type ShowRow } from "./common";
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
  const unsettled = new Set((deals.rows ?? []).filter((d) => !d.settled).map((d) => d.id));
  const plan = planHome({ role: p.role, musicianId: p.musicianId, shows: b.shows, asks: b.asks, today, unsettled });
  const { call, error } = useCommand();
  const pack = (showId: string) => (itemId: string, packed: boolean) => call("shows.packGear", { id: showId, itemId, packed });

  return (
    <div className="grid gap-3" data-testid="home-shows">
      <ErrorBox error={error} />
      {plan.today.map((s) => (
        <TodayCard key={s.id} show={s} b={b} onPack={pack(s.id)} deal={(deals.rows ?? []).find((d) => d.id === s.id)} contacts={contacts.rows ?? []} />
      ))}
      {plan.asks.map((a) => <AskCard key={a.id} av={a} />)}
      {plan.recent.map((s) => (
        <div key={s.id} className="card hi" data-testid={`recent-${s.id}`}>
          <span className="lbl">{s.date === addDays(today, -1) ? "Last night" : fmtLong(s.date)} · {s.venue.name}</span>
          {admin ? (
            <>
              <b>How&apos;d it go?</b>
              <span className="s">Rate it and enter the money</span>
              <Link href={`/shows/${s.id}/after`} className="btn acc" data-testid={`enter-money-${s.id}`}>Enter money</Link>
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
          <NextShow next={plan.next} upcoming={plan.upcoming} b={b} onPack={plan.next ? pack(plan.next.id) : () => undefined} />
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
  const open = s.checklist.filter((c) => !c.done);
  return (
    <div className="grid gap-3" data-testid={`today-${s.id}`}>
      <div className="card hi">
        <span className="lbl">Today</span>
        <b>{s.venue.name}{s.venue.city ? ` · ${s.venue.city}` : ""}</b>
        <span className="font-mono text-sm">{[s.venue.address, configName(b.artist, s.billedAs) ?? billingName(b.artist, s.billedAs)].filter(Boolean).join(" · ")}</span>
        <Times times={s.times} />
        <Link href={`/shows/${s.id}`} className="s font-semibold underline" data-testid={`today-open-${s.id}`}>Open show ›</Link>
      </div>
      <div className="grid gap-1.5" data-testid={`today-gear-${s.id}`}>
        <span className="lbl">Gear · {packedCount(s)}</span>
        <GearChecklist show={s} musicians={b.musicians} onPack={onPack} testidPrefix={`home-gear`} />
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
  const done = next.checklist.filter((c) => c.done).length, total = next.checklist.length;
  const playing = !!p.musicianId && next.personnel.includes(p.musicianId);
  const rest = upcoming.filter((s) => s.id !== next.id).slice(0, 4);
  return (
    <>
      <div className="grid gap-1.5" data-testid="next-show">
        <span className="lbl">Next show</span>
        <Link href={`/shows/${next.id}`} className="card" data-testid={`next-show-${next.id}`}>
          <b>{fmtLong(next.date)} · {next.venue.name}</b>
          <span className="font-mono text-sm">{[next.venue.city, next.times.loadIn && `Load in ${fmtTime(next.times.loadIn)}`, next.times.set && `Set ${fmtTime(next.times.set)}`, configName(b.artist, next.billedAs)].filter(Boolean).join(" · ")}</span>
          {total > 0 && <>
            <div className="h-1.5 overflow-hidden rounded-full bg-soft"><div className="h-full bg-accent" style={{ width: `${(done / total) * 100}%` }} /></div>
            <span className="s">Checklist {done} of {total}</span>
          </>}
        </Link>
      </div>
      {p.role === "member" && playing && next.gear.some((g) => g.musicianId === p.musicianId) && (
        <div className="grid gap-1.5" data-testid="bringing">
          <span className="lbl">You&apos;re bringing</span>
          <GearChecklist show={next} musicians={b.musicians} onPack={onPack} mineOnly testidPrefix="bring" />
        </div>
      )}
      {p.role === "member" && rest.length > 0 && (
        <div className="grid gap-1.5" data-testid="coming-up">
          <span className="lbl">Coming up</span>
          {rest.map((s) => (
            <Link key={s.id} href={`/shows/${s.id}`} className="card" data-testid={`coming-${s.id}`}>
              <div className="flex items-center justify-between"><b>{s.venue.name}</b><span className="s">{fmtLong(s.date)}{p.musicianId && !s.personnel.includes(p.musicianId) ? " · not playing" : ""}</span></div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
