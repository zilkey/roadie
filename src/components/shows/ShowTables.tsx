"use client";
import { useMemo, useState } from "react";
import Link from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { showTotals } from "@/lib/money";
import { fmtDur, fmtLong, fmtTime, showName, type ShowFilter } from "@/lib/shows";
import { fmtDuration } from "@/lib/duration";
import { setlistTotal, transitionOf } from "@/lib/music";
import { showFieldValue } from "@/lib/show-fields";
import type { Expense, Income, Payout, ShowField, Setlist } from "@/schema";
import type { Row } from "@/lib/firestore-hooks";
import type { ShowRow } from "./common";

const PAGE = 50;
const Dash = () => <span className="dash">—</span>;
const orDash = (v?: React.ReactNode) => (v ? v : <Dash />);

/** Whole dollars: 72500 -> "$725". Nothing entered (missing or 0) -> "". */
export const fmtDollars = (c?: number) => (c ? `${c < 0 ? "-" : ""}$${Math.round(Math.abs(c) / 100).toLocaleString("en-US")}` : "");
const mapsUrl = (a: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`;
/** The address the band drives to: the venue's copy (street, city), or a house concert's place. */
const addressOf = (s: ShowRow) => (s.venue ? s.venue.address || s.venue.city : s.place?.address || s.place?.city);

const DateCell = ({ s }: { s: ShowRow }) => <td className="date"><Link href={`/shows/${s.id}`} className="dl">{fmtLong(s.date)}</Link></td>;
const VenueCell = ({ s }: { s: ShowRow }) => <td className="venue">{showName(s)}</td>;
/** `cf` is the custom field columns, after the tab's own. */
function Head({ cols, cf }: { cols: [string, string?][]; cf: ShowField[] }) {
  return <thead><tr>{cols.map(([c, cls]) => <th key={c} className={cls}>{c}</th>)}{cf.map((f) => <th key={f.id} className="cf" data-testid={`shows-col-${f.id}`} title={f.description}>{f.label}</th>)}</tr></thead>;
}
/** A value longer than two lines is cut with "…"; hovering shows all of it. */
const FieldCells = ({ s, cf }: { s: ShowRow; cf: ShowField[] }) => <>{cf.map((f) => {
  const v = showFieldValue(f, s.fields).value; // the show's own value, else the field's default
  return <td key={f.id} className="cf">{v ? <span className="clamp" title={v}>{v}</span> : <Dash />}</td>;
})}</>;

/**
 * One table per Shows tab. `shows` is that tab's rows, already sorted. `fields` is the artist's show fields; those ticked "In table"
 * are extra columns on every tab, for admins only (show field values are admin-only, like the show page's Custom fields card).
 */
export function ShowTable({ tab, shows, setlists, admin, fields }: { tab: ShowFilter; shows: ShowRow[]; setlists: Row<Setlist>[]; admin: boolean; fields: ShowField[] }) {
  const cf = admin ? fields.filter((f) => f.inTable) : [];
  if (tab === "upcoming") return <Upcoming shows={shows} setlists={setlists} cf={cf} />;
  if (tab === "played") return <Played shows={shows} admin={admin} cf={cf} />;
  return <Off tab={tab} shows={shows} cf={cf} />;
}

const Empty = ({ tab, children }: { tab: ShowFilter; children: React.ReactNode }) => <div className="empty" data-testid={`shows-${tab}`}><span>{children}</span></div>;

function Wrap({ tab, children, foot }: { tab: ShowFilter; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="show-tw" data-testid={`shows-${tab}`}>
      <div className="show-scroll"><table className="show-table" data-testid={`shows-table-${tab}`}>{children}</table></div>
      {foot}
    </div>
  );
}

function Upcoming({ shows, setlists, cf }: { shows: ShowRow[]; setlists: Row<Setlist>[]; cf: ShowField[] }) {
  if (!shows.length) return <Empty tab="upcoming">No shows coming up.</Empty>;
  return (
    <Wrap tab="upcoming">
      <Head cols={[["Date"], ["Venue"], ["Address"], ["Load in"], ["Sound check"], ["Doors"], ["Show starts"], ["Set starts"], ["Sound"], ["Contact"], ["Setlist"]]} cf={cf} />
      <tbody>
        {shows.map((s) => {
          const addr = addressOf(s);
          const sl = setlists.find((x) => x.id === s.id);
          return (
            <tr key={s.id} data-testid="shows-row" data-id={s.id}>
              <DateCell s={s} /><VenueCell s={s} />
              <td className="addr">{addr ? <a href={mapsUrl(addr)} target="_blank" rel="noopener noreferrer">{addr}</a> : <Dash />}</td>
              <td className="t">{orDash(fmtTime(s.times.loadIn))}</td>
              <td className="t">{orDash(fmtTime(s.times.soundcheck))}</td>
              <td className="t">{orDash(fmtTime(s.times.doors))}</td>
              <td className="t">{orDash(fmtTime(s.times.showStart))}</td>
              <td className="t">{orDash(fmtTime(s.times.set))}</td>
              <td>{s.sound.provider === "bandProvided" ? <span className="chip a">We provide</span> : <span className="chip">They provide</span>}</td>
              <td className="contact" data-testid="shows-contact">{s.dayOfContact ? <>{s.dayOfContact.name}{s.dayOfContact.phone && <> · <a href={`tel:${s.dayOfContact.phone.replace(/[^\d+]/g, "")}`}>{s.dayOfContact.phone}</a></>}</> : <Dash />}</td>
              <td>{sl ? <Link href={`/shows/${s.id}?tab=setlist`}>{sl.items.filter((i) => i.type === "song").length} songs · {fmtDur(setlistTotal(sl.items, transitionOf(s)))}</Link> : <Dash />}</td>
              <FieldCells s={s} cf={cf} />
            </tr>
          );
        })}
      </tbody>
    </Wrap>
  );
}

function Played({ shows, admin, cf }: { shows: ShowRow[]; admin: boolean; cf: ShowField[] }) {
  const [n, setN] = useState(PAGE);
  const rows = shows.slice(0, n);
  // Admins only: summed live from the band's income, payouts and expenses (not showDeals.totals, which only shows with a
  // booked deal have, and imported money never refreshed). Same math as the show page's Net card: income - paid out - expenses.
  const income = useCollection<Income>("income", { skip: !admin }).rows;
  const payouts = useCollection<Payout>("payouts", { skip: !admin }).rows;
  const expenses = useCollection<Expense>("expenses", { skip: !admin }).rows;
  const byShow = useMemo(() => {
    const m = new Map<string, { income: Income[]; payouts: Payout[]; expenses: Expense[] }>();
    const at = (id: string) => m.get(id) ?? (m.set(id, { income: [], payouts: [], expenses: [] }), m.get(id)!);
    for (const x of income ?? []) if (x.showId) at(x.showId).income.push(x);
    for (const x of payouts ?? []) if (x.showId) at(x.showId).payouts.push(x);
    for (const x of expenses ?? []) if (x.showId) at(x.showId).expenses.push(x);
    return new Map([...m].map(([id, v]) => [id, showTotals(v)]));
  }, [income, payouts, expenses]);
  if (!shows.length) return <Empty tab="played">Nothing yet.</Empty>;
  const loaded = !!income && !!payouts && !!expenses;
  // Nothing recorded on a show -> dashes, not $0.
  const totals = (id: string) => (loaded ? byShow.get(id) : undefined);
  const sum = (k: "income" | "expenses") => rows.reduce((a, s) => a + (totals(s.id)?.[k] ?? 0), 0);
  const netOf = (id: string) => totals(id)?.net;
  const netSum = rows.reduce((a, s) => a + (netOf(s.id) ?? 0), 0);
  const foot = (
    <div className="show-foot" data-testid="shows-totals">
      <span>Showing {rows.length} of {shows.length}</span>
      {admin && <span>Loaded: income <b>{fmtDollars(sum("income")) || "$0"}</b> · expenses <b>{fmtDollars(sum("expenses")) || "$0"}</b> · net <b>{fmtDollars(netSum) || "$0"}</b></span>}
    </div>
  );
  return (
    <>
      <Wrap tab="played" foot={foot}>
        <Head cols={[["Date"], ["Venue"], ["Duration"], ...(admin ? [["Total income", "num"], ["Total expenses", "num"], ["Net", "num"]] as [string, string][] : [])]} cf={cf} />
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} data-testid="shows-row" data-id={s.id}>
              <DateCell s={s} /><VenueCell s={s} />
              <td className="t">{orDash(fmtDuration(s.times.setLengthSec))}</td>
              {admin && <td className="num">{orDash(fmtDollars(totals(s.id)?.income))}</td>}
              {admin && <td className="num">{orDash(fmtDollars(totals(s.id)?.expenses))}</td>}
              {admin && <td className="num" data-testid="shows-net">{netOf(s.id) === undefined ? <Dash /> : fmtDollars(netOf(s.id)) || "$0"}</td>}
              <FieldCells s={s} cf={cf} />
            </tr>
          ))}
        </tbody>
      </Wrap>
      {shows.length > n && <button type="button" className="btn outline justify-self-start" data-testid="shows-more" onClick={() => setN(n + PAGE)}>Show 50 more</button>}
    </>
  );
}

function Off({ tab, shows, cf }: { tab: "canceled" | "dropped"; shows: ShowRow[]; cf: ShowField[] }) {
  if (!shows.length) return <Empty tab={tab}>No {tab} shows.</Empty>;
  return (
    <Wrap tab={tab}>
      <Head cols={[["Date"], ["Venue"], ["Reason"]]} cf={cf} />
      <tbody>
        {shows.map((s) => (
          <tr key={s.id} data-testid="shows-row" data-id={s.id}>
            <DateCell s={s} /><VenueCell s={s} />
            <td className="reason">{orDash(s.reason)}</td>
            <FieldCells s={s} cf={cf} />
          </tr>
        ))}
      </tbody>
    </Wrap>
  );
}
