"use client";
import { useState } from "react";
import Link from "@/lib/artist";
import { useDocs } from "@/lib/firestore-hooks";
import { fmtDur, fmtLong, fmtTime, showName, type ShowFilter } from "@/lib/shows";
import { fmtDuration, setLengthOf } from "@/lib/duration";
import type { ShowDeal, Setlist } from "@/schema";
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
const Head = ({ cols }: { cols: [string, string?][] }) => <thead><tr>{cols.map(([c, cls]) => <th key={c} className={cls}>{c}</th>)}</tr></thead>;

/** One table per Shows tab. `shows` is that tab's rows, already sorted. */
export function ShowTable({ tab, shows, setlists, admin }: { tab: ShowFilter; shows: ShowRow[]; setlists: Row<Setlist>[]; admin: boolean }) {
  if (tab === "upcoming") return <Upcoming shows={shows} setlists={setlists} />;
  if (tab === "played") return <Played shows={shows} admin={admin} />;
  return <Off tab={tab} shows={shows} />;
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

function Upcoming({ shows, setlists }: { shows: ShowRow[]; setlists: Row<Setlist>[] }) {
  if (!shows.length) return <Empty tab="upcoming">No shows coming up.</Empty>;
  return (
    <Wrap tab="upcoming">
      <Head cols={[["Date"], ["Venue"], ["Address"], ["Load in"], ["Sound check"], ["Doors"], ["Show starts"], ["Downbeat"], ["Sound"], ["Contact"], ["Setlist"]]} />
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
              <td>{sl ? <Link href={`/shows/${s.id}?tab=setlist`}>{sl.items.filter((i) => i.type === "song").length} songs · {fmtDur(sl.totalSec)}</Link> : <Dash />}</td>
            </tr>
          );
        })}
      </tbody>
    </Wrap>
  );
}

function Played({ shows, admin }: { shows: ShowRow[]; admin: boolean }) {
  const [n, setN] = useState(PAGE);
  const rows = shows.slice(0, n);
  // Admins only (rules make showDeals admin-only): one read per row on screen.
  const deals = useDocs<ShowDeal>("showDeals", rows.map((s) => s.id), { skip: !admin });
  if (!shows.length) return <Empty tab="played">Nothing yet.</Empty>;
  const totals = (id: string) => deals.byId.get(id)?.totals;
  const sum = (k: "income" | "expenses") => rows.reduce((a, s) => a + (totals(s.id)?.[k] ?? 0), 0);
  const foot = (
    <div className="show-foot" data-testid="shows-totals">
      <span>Showing {rows.length} of {shows.length}</span>
      {admin && <span>Loaded: income <b>{fmtDollars(sum("income")) || "$0"}</b> · expenses <b>{fmtDollars(sum("expenses")) || "$0"}</b></span>}
    </div>
  );
  return (
    <>
      <Wrap tab="played" foot={foot}>
        <Head cols={[["Date"], ["Venue"], ["Duration"], ...(admin ? [["Total income", "num"], ["Total expenses", "num"]] as [string, string][] : [])]} />
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} data-testid="shows-row" data-id={s.id}>
              <DateCell s={s} /><VenueCell s={s} />
              <td className="t">{orDash(fmtDuration(setLengthOf(s.times)))}</td>
              {admin && <td className="num">{orDash(fmtDollars(totals(s.id)?.income))}</td>}
              {admin && <td className="num">{orDash(fmtDollars(totals(s.id)?.expenses))}</td>}
            </tr>
          ))}
        </tbody>
      </Wrap>
      {shows.length > n && <button type="button" className="btn outline justify-self-start" data-testid="shows-more" onClick={() => setN(n + PAGE)}>Show 50 more</button>}
    </>
  );
}

function Off({ tab, shows }: { tab: "canceled" | "dropped"; shows: ShowRow[] }) {
  if (!shows.length) return <Empty tab={tab}>No {tab} shows.</Empty>;
  return (
    <Wrap tab={tab}>
      <Head cols={[["Date"], ["Venue"], ["Reason"]]} />
      <tbody>
        {shows.map((s) => (
          <tr key={s.id} data-testid="shows-row" data-id={s.id}>
            <DateCell s={s} /><VenueCell s={s} />
            <td className="reason">{orDash(s.reason)}</td>
          </tr>
        ))}
      </tbody>
    </Wrap>
  );
}
