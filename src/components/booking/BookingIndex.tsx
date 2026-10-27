"use client";
import { draftPath } from "@/schema/drafts";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection } from "@/lib/firestore-hooks";
import { useHasDraft } from "@/lib/drafts";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";
import { Menu } from "@/components/Menu";
import {
  EntityForm, Tabs, StatusChip, contactForm, type SubmitMeta, festivalForm, hrefFor, promoterForm, useBooking, venueForm,
} from "@/components/booking/common";
import { PitchModal, type PitchTarget } from "@/components/booking/PitchModal";
import { fmtPhone, listRows, type ListRow, type Place, type Ref } from "@/components/booking/listRows";
import { useVenueTypes } from "@/lib/venueTypes";
import { CheckFilter } from "@/components/booking/CheckFilter";
import { FESTIVAL_SORTS, type FestivalSort } from "@/lib/festivalPage";
import { useFestivalPage } from "@/components/booking/useFestivalPage";
import { QUIET_DAYS, STATUSES, STATUS_LABEL, buildSearchItems, fmtDate, highlight, isActive, pitchCellText, quietDays, searchItems, todayStr, type Status } from "@/lib/booking";
import { fmtInstant } from "@/lib/timezone";
import type { Show } from "@/schema";
import { SearchBuckets } from "@/components/booking/SearchBuckets";

/** The booking index. Each tab has its own route (/booking, /booking/pitches, /booking/venues, …) so it can be linked to. */
export function BookingIndex({ seg }: { seg: Seg }) { return <AdminOnly><Booking seg={seg} /></AdminOnly>; }

export type Seg = "pitches" | "venues" | "festivals" | "promoters" | "contacts";
type Add = null | "venue" | "promoter" | "festival" | "contact";

function Booking({ seg }: { seg: Seg }) {
  const router = useRouter();
  const b = useBooking();
  const { call, error } = useCommand();
  // The search survives switching tabs: it rides along as ?q= on the tab's route.
  const params = useSearchParams();
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const setSeg = (s: Seg) => router.push(`/booking/${s}${q.trim() ? `?q=${encodeURIComponent(q)}` : ""}`);
  // Clearing the search (the field's own cancel button, or deleting the text) brings the tab back and drops ?q= from the URL.
  const changeQ = (v: string) => {
    setQ(v);
    if (!v.trim() && params.get("q") !== null) router.replace(`/booking/${seg}`);
  };
  // An unfinished "new X" opens its form by itself (a draft link to it opens the form).
  const drafts = { venue: useHasDraft(draftPath.newIn("venues")), promoter: useHasDraft(draftPath.newIn("promoters")), festival: useHasDraft(draftPath.newIn("festivals")), contact: useHasDraft(draftPath.newIn("contacts")) };
  const [explicit, setAdd] = useState<Add | "none" | undefined>(undefined);
  const add: Add = explicit === "none" ? null : explicit ?? (["venue", "promoter", "festival", "contact"] as const).find((k) => drafts[k]) ?? null;

  // Rooms this band has something on (notes, a pitch, a show) come first; the rest of the shared directory follows.
  const shows = useCollection<Show>("shows");
  const ours = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, n] of b.venueNotes) if (!n.deletedAt) ids.add(id);
    for (const p of b.pitches) if (p.target.kind === "venue") ids.add(p.target.id);
    for (const s of shows.rows ?? []) if (s.venue) ids.add(s.venue.id);
    return ids;
  }, [b.venueNotes, b.pitches, shows.rows]);

  // Pitch List only: narrow to one status ("" = every active pitch), a category, places and venue types (none checked = all).
  const [status, setStatus] = useState<Status | "">("");
  const [category, setCategory] = useState<Category | "">("");
  const [place, setPlace] = useState<string[]>([]);
  const [venueType, setVenueType] = useState<string[]>([]);
  const statusFilter = seg === "pitches" ? status : "";
  const listed = useMemo(() => {
    const searching = q.trim().length > 0;
    const hit = searching ? new Set(searchItems(buildSearchItems(b), q).map((i) => `${i.kind}:${i.id}`)) : null;
    return listRows(b, seg, ours, hit, statusFilter || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.venues, b.promoters, b.festivals, b.editions, b.contacts, b.pitches, ours, q, seg, statusFilter]);
  const types = useVenueTypes();
  const places = useMemo(() => placeOptions(listed), [listed]);
  const typeFilter = category === "festival" ? [] : venueType; // venue types mean nothing to festivals: the filter hides
  const rows = useMemo(() => seg !== "pitches" ? listed : listed.filter((r) =>
    (!category || CATEGORY_KINDS[category].includes(r.kind)) && (!place.length || r.places.some((p) => placeKeys(p).some((k) => place.includes(k)))) && (!typeFilter.length || typeFilter.includes(r.venueType ?? "")),
  ), [listed, seg, category, place, typeFilter]);
  const filtering = !!(status || category || place.length || typeFilter.length);

  // Festivals tab: the server searches, sorts and pages it (festivals.page); the rows are drawn from the live data in that order.
  const [sort, setSortState] = useState<FestivalSort>(() => {
    const s = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("sort");
    return (FESTIVAL_SORTS as readonly string[]).includes(s ?? "") ? (s as FestivalSort) : "name";
  });
  const setSort = (s: FestivalSort) => {
    setSortState(s);
    const qs = new URLSearchParams({ ...(q.trim() ? { q } : {}), ...(s !== "name" ? { sort: s } : {}) }).toString();
    router.replace(`/booking/festivals${qs ? `?${qs}` : ""}`);
  };
  const version = useMemo(() => JSON.stringify([b.festivals.map((f) => [f.id, f.rev]), b.editions.map((e) => [e.id, e.rev])]), [b.festivals, b.editions]);
  const page = useFestivalPage({ q: q.trim(), sort, enabled: seg === "festivals", version });
  const festivalRowsShown = useMemo(() => {
    if (seg !== "festivals" || !page.rows) return [];
    const all = new Map(listRows(b, "festivals", ours, null).map((r) => [`${r.kind}:${r.id}`, r]));
    return page.rows.flatMap((ref) => all.get(`${ref.kind}:${ref.id}`) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seg, page.rows, b.festivals, b.editions, b.contacts, b.pitches, ours]);
  const shownRows = seg === "festivals" ? festivalRowsShown : rows;
  const listLoading = b.loading || (seg === "festivals" && !page.rows);
  const [target, setTarget] = useState<PitchTarget | null>(null);
  const activeCount = b.pitches.filter((p) => isActive(p.status)).length;


  async function create(kind: Exclude<Add, null>, data: Record<string, unknown>, meta: SubmitMeta) {
    const cmd = { venue: "venues.create", promoter: "promoters.create", festival: "festivals.create", contact: "contacts.create" }[kind];
    const r = await call<{ id: string }>(cmd, data, meta);
    if (r) router.push(hrefFor(kind, r.id));
    return !!r;
  }
  const forms = { venue: venueForm, promoter: promoterForm, festival: festivalForm, contact: contactForm };

  const addActions = (
    <Menu label="Add to booking" testid="booking-add" triggerClass="btn acc" trigger={<span className="px-1 font-semibold">+ Add ▾</span>}
      items={(["venue", "promoter", "festival", "contact"] as const).map((k) => ({
        key: k, testid: `add-${k}`, label: `+ Add ${k === "festival" ? "festival or series" : k === "venue" ? "a place" : k}`,
        onSelect: () => setAdd(add === k ? "none" : k),
      }))} />
  );
  const form = add && (
    <>
    <EntityForm key={add} testid={`new-${add}`} fields={forms[add].fields} initial={forms[add].blank} build={forms[add].build}
      submitLabel={`Add ${add}`} onSubmit={(d, meta) => create(add, d, meta)} onCancel={() => setAdd("none")}
      draft={{ path: draftPath.newIn(`${add}s`), title: (v) => `New ${add}${v.name ? ` · ${v.name}` : ""}` }} />
    {add === "venue" && <p className="s" data-testid="new-venue-shared-note">Other bands will see this venue&apos;s name, address and details.</p>}
    </>
  );
  // No data at all: only the welcome card (and the open "new X" form), none of the usual search, tabs and lists.
  const nothingYet = !b.loading && [b.venues, b.promoters, b.festivals, b.editions, b.contacts, b.pitches].every((x) => x.length === 0);
  if (nothingYet) {
    return (
      <WelcomeEmpty section="booking" title="Welcome to Booking!"
        body="This is home base for every venue, festival, promoter and contact you might play with. Build a pitch list of the places you'd love to play, then send pitches from your own email templates."
        actions={<button className="btn acc" data-testid="add-venue" onClick={() => setAdd(add === "venue" ? "none" : "venue")}>+ Add a place</button>}>
        <ErrorBox error={error} />
        {form}
      </WelcomeEmpty>
    );
  }

  return (
    <div className="grid gap-5">
      <PageTitle title="Booking" center actions={<>
        <label className="search-field">
          <SearchIcon />
          <input className="input" type="search" placeholder="Search places, festivals, contacts…" value={q} onChange={(e) => changeQ(e.target.value)} data-testid="booking-search" aria-label="Search booking" />
        </label>
        {addActions}
      </>} />
      <Tabs<Seg> testid="booking-seg" value={seg} onChange={setSeg}
        options={[["pitches", <>Pitch List <span className="chip a ml-1" data-testid="pitch-count">{activeCount}</span></>], ["venues", "Venues"], ["festivals", "Festivals & series"], ["promoters", "Promoters"], ["contacts", "Contacts"]]} />
      <ErrorBox error={error} />

      {seg === "pitches" && !q.trim() && (
        <div className="pitch-filter flex flex-wrap items-center gap-2 justify-self-start" data-testid="pitch-filter">
          <span className="s font-semibold whitespace-nowrap">Filter by</span>
          <select className="select w-auto" value={status} onChange={(e) => setStatus(e.target.value as Status | "")} aria-label="Filter pitches by status" data-testid="pitch-status-filter">
            <option value="">All active</option>
            {STATUSES.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
          </select>
          <select className="select w-auto" value={category} onChange={(e) => setCategory(e.target.value as Category | "")} aria-label="Filter pitches by category" data-testid="pitch-category-filter">
            <option value="">All categories</option>
            {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <CheckFilter label="Filter pitches by city or state" all="All places" noun="places" testid="pitch-place-filter" value={place} onChange={setPlace}
            groups={[{ label: "States", options: places.states.map((st) => ({ key: `state:${st}`, label: st })) }, { label: "Cities", options: places.cities }]} />
          {category !== "festival" && (
            <CheckFilter label="Filter pitches by venue type" all="All venue types" noun="venue types" testid="pitch-type-filter" value={venueType} onChange={setVenueType}
              groups={[{ options: types.map((t) => ({ key: t.id, label: t.label })) }]} />
          )}
        </div>
      )}
      {q.trim() ? <SearchBuckets q={q} ours={ours} onFlag={setTarget} /> : <>
      <div className="grid min-w-0 gap-3" data-testid={seg === "pitches" ? "pitch-list" : "booking-list"}>
        {seg === "festivals" && <ErrorBox error={page.error} />}
        {listLoading && <span className="s">Loading…</span>}
        {!listLoading && shownRows.length === 0 && (seg === "pitches" && !q.trim() && !filtering
          ? <div className="empty"><span>Nothing on the Pitch List. Tap a flag to add something.</span></div>
          : <div className="empty" data-testid="no-results"><span>Nothing matches.</span></div>)}
        {shownRows.length > 0 && <div className="book-tw"><BookingTable seg={seg} rows={shownRows} onFlag={setTarget} sort={sort} onSort={setSort} /></div>}
        {seg === "festivals" && page.hasMore && (
          <button type="button" className="btn ghost justify-self-center" disabled={page.loadingMore} onClick={() => void page.more()} data-testid="festivals-more">
            {page.loadingMore ? "Loading…" : `Load more (${page.total - (page.rows?.length ?? 0)} left)`}
          </button>
        )}
      </div>
      </>}
      <PitchModal target={target} onClose={() => setTarget(null)} />
      {form}
    </div>
  );
}

type Category = "venue" | "festival" | "promoter";
const CATEGORIES: [Category, string][] = [["venue", "Venues"], ["festival", "Festivals"], ["promoter", "Promoters"]];
const CATEGORY_KINDS: Record<Category, ListRow["kind"][]> = { venue: ["venue"], festival: ["festival", "edition"], promoter: ["promoter"] };
const placeKeys = (p: Place) => [`state:${p.state}`, `city:${p.city}|${p.state}`];
/** The place filter's choices: the states, then the towns ("Denver, CO"), of the rows on the list. */
function placeOptions(rows: ListRow[]) {
  const states = new Set<string>(), cities = new Map<string, string>();
  for (const p of rows.flatMap((r) => r.places)) { states.add(p.state); cities.set(`city:${p.city}|${p.state}`, `${p.city}, ${p.state}`); }
  return {
    states: [...states].sort(),
    cities: [...cities].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** Festivals tab: the headers that sort, and what a tap does (a new column sorts soonest first; tapping it again flips it). */
const SORT_BY: Record<string, "name" | "deadline" | "date"> = { Festival: "name", Dates: "date", Deadline: "deadline" };
const nextSort = (cur: FestivalSort, by: "name" | "deadline" | "date"): FestivalSort =>
  by === "name" ? "name" : cur === by ? (`-${by}` as FestivalSort) : by;

const Dash = () => <span className="dash">—</span>;
const SearchIcon = () => (
  <svg className="search-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  </svg>
);

const FlagIcon = ({ filled }: { filled: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 21V4" /><path d="M5 4h12l-2.5 4L17 12H5" />
  </svg>
);

/** `q` marks the matched text in the name and email cells; without `onSort` the headers don't sort (search buckets). */
export function BookingTable({ seg, rows, onFlag, sort = "name", onSort, q = "" }: { seg: Seg; rows: ListRow[]; onFlag(t: PitchTarget): void; sort?: FestivalSort; onSort?(s: FestivalSort): void; q?: string }) {
  const hl = (text: string): ReactNode => {
    if (!q.trim()) return text;
    const h = highlight(text, q);
    return h.match ? <>{h.before}<mark>{h.match}</mark>{h.after}</> : text;
  };
  const router = useRouter();
  const artist = useArtist();
  const configs = artist.doc?.configurations ?? [];
  const flagged = seg !== "contacts";
  const wideName = seg !== "promoters" && seg !== "contacts";
  const heads: string[] = seg === "venues" ? ["Name", "City", "Email", "Phone", "Pitch"]
    : seg === "festivals" ? ["Festival", "Edition", "Dates", "Deadline", "City", "Email", "Phone", "Pitch"]
    : seg === "promoters" ? ["Promoter", "Name", "City", "Email", "Phone", "Pitch"]
    : seg === "contacts" ? ["Name", "Organization", "City", "Email", "Phone"]
    : ["Name", "Type", "City", "Pitch", "Last contact", "Next step"];
  const today = todayStr();
  // Pitch List: Pitched or Talking with no contact (or, never contacted, since it was added) for QUIET_DAYS turns the row yellow.
  const quiet = (r: ListRow) => {
    const p = r.pitch;
    return seg === "pitches" && !!p && (quietDays(p.status, (p.lastContactAt ?? p.createdAt)?.toMillis(), today) ?? 0) >= QUIET_DAYS;
  };
  const lastContact = (r: ListRow) => {
    const at = r.pitch?.lastContactAt;
    return <td className="lc" data-testid={`last-contact-${r.id}`}>{at ? fmtInstant(at.toMillis(), { month: "short", day: "numeric" }) : <Dash />}</td>;
  };
  const link = (r: Ref, testid?: string) => <Link href={hrefFor(r.kind, r.id)} className="nm" data-testid={testid}>{hl(r.name)}</Link>;
  // A row with an active pitch opens the pitch from its name; the place page is one click under it ("Venue page"). Without a pitch the name is the place page.
  const nameLink = (r: ListRow, ref: Ref, testid: string, label?: string) => r.pitch ? (<>
    <Link href={`/booking/pitches/${r.pitch.id}`} className="nm" data-testid={testid}>{hl(ref.name)}</Link>
    {label && <span className="sub"><Link href={hrefFor(r.to.kind, r.to.id)} data-testid={`page-link-${r.id}`}>{label}</Link></span>}
  </>) : link(ref, testid);
  const flag = (r: ListRow) => {
    if (!r.flag) return <td className="flag" />;
    const on = !!r.pitch;
    return (
      <td className="flag">
        <button type="button" className="flag-ic" data-testid={`flag-${r.id}`} data-flagged={on ? "1" : "0"} aria-pressed={on}
          aria-label={on ? `${r.name} is on the Pitch List` : `Add ${r.name} to the Pitch List`}
          onClick={() => r.pitch ? router.push(`/booking/pitches/${r.pitch.id}`)
            : onFlag({ kind: r.kind as PitchTarget["kind"], id: r.id, name: r.name, meta: [r.type, r.city].filter(Boolean).join(" · ") })}>
          <FlagIcon filled={on} />
        </button>
      </td>
    );
  };
  const pitchCell = (r: ListRow) => {
    const p = r.pitch;
    return (
      <td className="pitch" data-testid={`pitch-cell-${r.id}`}>
        <div className="pw">{p && (() => { const t = pitchCellText(p, configs); return <><span className="pc">{t.config}</span>{" "}<span className="pd">{t.dates}</span></>; })()}</div>
      </td>
    );
  };
  const status = (r: ListRow) => r.pitch && <> <StatusChip status={r.pitch.status} /></>;
  const reach = (r: ListRow) => (<>
    <td>{r.email ? <a className="em" href={`mailto:${r.email}`}>{hl(r.email)}</a> : <Dash />}</td>
    <td className="nw">{r.phone ? <a className="ph" href={`tel:${r.phone}`}>{fmtPhone(r.phone)}</a> : <Dash />}</td>
  </>);
  const city = (r: ListRow) => <td className="nw">{r.city || <Dash />}</td>;
  const nextStep = (r: ListRow) => {
    const n = r.pitch?.nextStep;
    return <td className="ns" data-testid={`next-step-${r.id}`}>{n ? <>{n.text}<span className="sub">by {fmtDate(n.due)}</span></> : <Dash />}</td>;
  };
  const nameCell = (r: ListRow) => (
    <td className="name">
      {seg === "pitches" ? <Link href={r.pitch ? `/booking/pitches/${r.pitch.id}` : hrefFor(r.to.kind, r.to.id)} className="nm" data-testid={`${r.kind}-full-${r.id}`}>{hl(r.name)}</Link>
        : nameLink(r, r.to, `${r.kind}-full-${r.id}`, "Venue page")}{status(r)}
      {r.promoters.length > 0 && <span className="sub">promoted by {r.promoters.map((p, i) => <span key={p.id}>{i > 0 && ", "}<Link href={hrefFor("promoter", p.id)}>{p.name}</Link></span>)}</span>}
    </td>
  );

  return (
    <table className={wideName ? "book-table wn" : "book-table"}>
      <thead><tr>
        {flagged && <th className="flag" aria-label="Pitch List flag" />}
        {heads.map((h, i) => {
          const sortBy = seg === "festivals" && onSort ? SORT_BY[h] : undefined;
          const on = sortBy && sort.replace("-", "") === sortBy;
          return (
            <th key={h} className={h === "Pitch" ? "pitch" : h === "Last contact" ? "lc" : wideName && i === 0 ? "name" : h === "Dates" || h === "Deadline" ? "nw" : undefined}
              aria-sort={on ? (sort.startsWith("-") ? "descending" : "ascending") : undefined}>
              {sortBy ? (
                <button type="button" className="th-sort" data-testid={`sort-${sortBy}`} onClick={() => onSort?.(nextSort(sort, sortBy))}>
                  {h}{on && <span aria-hidden> {sort.startsWith("-") ? "▼" : "▲"}</span>}
                </button>
              ) : h}
            </th>
          );
        })}
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.kind}:${r.id}`} data-testid={`row-${r.kind}-${r.id}`} data-quiet={quiet(r) ? "1" : undefined}>
            {flagged && flag(r)}
            {seg === "festivals" ? (<>
              <td className="name">{link(r.festival!, r.kind === "festival" ? `festival-full-${r.id}` : `festival-name-${r.id}`)}</td>
              <td className="nw">{r.edition ? <>{nameLink(r, r.edition, `edition-full-${r.id}`, "Festival page")}{status(r)}</> : <Link href={`/booking/festivals/${r.id}?addEdition=1`} className="nm" data-testid={`add-edition-${r.id}`}>Add edition</Link>}</td>
              <td className="nw" data-testid={`dates-${r.id}`}>{r.startDate ? `${fmtDate(r.startDate)}${r.endDate && r.endDate !== r.startDate ? `–${fmtDate(r.endDate)}` : ""}` : <Dash />}</td>
              <td className="nw" data-testid={`deadline-${r.id}`}>{r.deadline ? <>{fmtDate(r.deadline.date)}{r.deadline.sure !== "confirmed" && <span className="s" title={r.deadline.sure === "target" ? "Our target" : "Estimated"}> {r.deadline.sure === "target" ? "(target)" : "(est.)"}</span>}</> : <Dash />}</td>
            </>) : seg === "promoters" ? (<>
              <td>{nameLink(r, r.to, `promoter-full-${r.id}`, "Promoter page")}{status(r)}</td>
              <td>{r.person ?? <Dash />}</td>
            </>) : seg === "contacts" ? (<>
              <td>{link(r.to, `contact-full-${r.id}`)}</td>
              <td>{r.organization ? link(r.organization) : <Dash />}</td>
            </>) : (<>
              {nameCell(r)}
              {seg === "pitches" && <td className="nw">{r.type}</td>}
            </>)}
            {city(r)}
            {seg !== "pitches" && reach(r)}
            {seg !== "contacts" && pitchCell(r)}
            {seg === "pitches" && lastContact(r)}
            {seg === "pitches" && nextStep(r)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
