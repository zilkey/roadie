"use client";
import { draftPath } from "@/schema/drafts";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection } from "@/lib/firestore-hooks";
import { useHasDraft } from "@/lib/drafts";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";
import { Menu } from "@/components/Menu";
import {
  EntityForm, StatusChip, type PitchRow, type SubmitMeta, actForm, festivalForm, hrefFor, promoterForm, useBooking, venueForm,
} from "@/components/booking/common";
import { PitchModal, type PitchTarget } from "@/components/booking/PitchModal";
import { fmtPhone, listRows, type ListRow, type Place, type Ref } from "@/components/booking/listRows";
import { useVenueTypes } from "@/lib/venueTypes";
import { CheckFilter } from "@/components/booking/CheckFilter";
import { FESTIVAL_SORTS, type FestivalSort } from "@/lib/festivalPage";
import { useFestivalPage } from "@/components/booking/useFestivalPage";
import { QUIET_DAYS, STATUSES, STATUS_LABEL, isActive, buildSearchItems, fmtDate, highlight, pitchCellText, quietDays, searchItems, todayStr, type Status } from "@/lib/booking";
import { fmtInstant } from "@/lib/timezone";
import type { Show } from "@/schema";
import { AddToTourDialog } from "@/components/booking/AddToTourDialog";
import { SearchBuckets } from "@/components/booking/SearchBuckets";
import { VenueCalendars } from "@/components/booking/VenueCalendars";
import { ROUTES } from "@/lib/routes";
import { ActsTab } from "@/components/booking/ActsTab";
import { Crumbs, useBookingSearch } from "@/components/booking/BookingNav";
import { homeOf, inCampaign, liveCampaigns, ONGOING, statusCounts, type CampaignKey } from "@/lib/campaigns";
import { InlineValue } from "@/components/InlineValue";
import { MoveToCampaignDialog } from "@/components/booking/MoveToCampaign";
import { FlagCampaignSelect, useFlagCampaign } from "@/components/booking/FlagCampaign";
import { groupByPromoter, type Grouped } from "@/lib/promoterGroups";
import { emailCells, type ThreadLike } from "@/lib/emailCells";
import { queueHref, type QueueItem } from "@/lib/emailQueue";
import { FollowUpDialog } from "@/components/booking/FollowUpDialog";

/** A new next step's date when only its words are given: a week out. */
const weekOut = () => { const d = new Date(todayStr() + "T12:00:00"); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); };
import type { EmailThread } from "@/schema";
import type { Campaign } from "@/schema";
import { WeKnowChip, useVenuesWeKnow } from "@/components/booking/WhoWeKnow";

/** The booking index. Each section has its own route (/booking, /booking/pitches, /booking/venues, …) so it can be linked to; the Booking sub-nav (BookingNav) switches between them. */
export function BookingIndex({ seg, campaign }: { seg: Tab; /** seg "pitches": a campaign's page, by id, or ONGOING. */ campaign?: CampaignKey }) {
  return <AdminOnly><Booking seg={seg} campaign={seg === "pitches" ? campaign ?? ONGOING : undefined} /></AdminOnly>;
}

/** The table kinds. Contacts is not a Booking section (it has its own section) but its table still draws the search results. */
export type Seg = "pitches" | "venues" | "festivals" | "promoters" | "contacts";
/** "calendars" (Venue calendars) is every venue's upcoming shows and "acts" the bands on them (#77): not tables of booking records, so no ListRow kind. */
type Tab = Exclude<Seg, "contacts"> | "calendars" | "acts";
type Add = null | "venue" | "promoter" | "festival" | "act";

function Booking({ seg, campaign }: { seg: Tab; campaign?: CampaignKey }) {
  const router = useRouter();
  const b = useBooking();
  const weKnow = useVenuesWeKnow(b, seg !== "venues");
  const { call, error } = useCommand();
  // A campaign page (#82) is the pitch table narrowed to that campaign's pitches before each place picks its one (M9).
  const live = useMemo(() => liveCampaigns(b.campaigns), [b.campaigns]);
  const camp = campaign && campaign !== ONGOING ? live.get(campaign) : undefined;
  const scope = useMemo(() => campaign ? (p: PitchRow) => inCampaign(p, campaign, live) : undefined, [campaign, live]);
  // Reached from a campaign's "Add pitches from" (?campaign=): the trail leads back to it (Jeff, 2026-11-12).
  const carried = useSearchParams().get("campaign");
  const fromCampaign = !campaign && carried && (carried === ONGOING || live.has(carried))
    ? { label: carried === ONGOING ? ROUTES.bookingPitches.title : live.get(carried)!.name, href: carried === ONGOING ? ROUTES.bookingPitches.path : `/booking/campaigns/${carried}` } : null;
  const base = campaign ? (campaign === ONGOING ? ROUTES.bookingPitches.path : `/booking/campaigns/${campaign}`) : `/booking/${seg}`;
  // The search survives switching sections: the sub-nav's links carry it along as ?q= on the section's route.
  const params = useSearchParams();
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const search = useBookingSearch();
  useEffect(() => { search.setQ(q); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => search.setQ(""), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Clearing the search (the field's own cancel button, or deleting the text) brings the list back and drops ?q= from the URL.
  const changeQ = (v: string) => {
    setQ(v);
    if (!v.trim() && params.get("q") !== null) router.replace(`${base}${keepCampaign()}`);
  };
  // An unfinished "new X" opens its form by itself (a draft link to it opens the form).
  const drafts = { venue: useHasDraft(draftPath.newIn("venues")), promoter: useHasDraft(draftPath.newIn("promoters")), festival: useHasDraft(draftPath.newIn("festivals")), act: useHasDraft(draftPath.newIn("acts")) };
  const [explicit, setAdd] = useState<Add | "none" | undefined>(undefined);
  const add: Add = explicit === "none" ? null : explicit ?? (["venue", "promoter", "festival", "act"] as const).find((k) => drafts[k]) ?? null;

  // Rooms this band has something on (notes, a pitch, a show) come first; the rest of the shared directory follows.
  const shows = useCollection<Show>("shows");
  const ours = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, n] of b.venueNotes) if (!n.deletedAt) ids.add(id);
    for (const p of b.pitches) if (p.target.kind === "venue") ids.add(p.target.id);
    for (const s of shows.rows ?? []) if (s.venue) ids.add(s.venue.id);
    return ids;
  }, [b.venueNotes, b.pitches, shows.rows]);

  // Campaign pages only: narrow to one status ("" = every active pitch, "all" = any), a category, places and venue types (none checked = all).
  // A closed campaign opens on every status: it has no active pitches of its own left, only its history.
  const [statusPick, setStatus] = useState<Status | "" | "all" | null>(null);
  const status = statusPick ?? (camp?.status === "closed" ? "all" : "");
  const [category, setCategory] = useState<Category | "">("");
  const [place, setPlace] = useState<string[]>([]);
  const [venueType, setVenueType] = useState<string[]>([]);
  const statusFilter = seg === "pitches" ? status : "";
  const listSeg: Exclude<Seg, "contacts"> = seg === "calendars" || seg === "acts" ? "venues" : seg; // these tabs draw no ListRows; any table kind will do
  const listed = useMemo(() => {
    const searching = q.trim().length > 0;
    const hit = searching ? new Set(searchItems(buildSearchItems(b), q).map((i) => `${i.kind}:${i.id}`)) : null;
    return listRows(b, listSeg, ours, hit, statusFilter || undefined, seg === "pitches" ? scope : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.venues, b.promoters, b.festivals, b.editions, b.contacts, b.pitches, ours, q, listSeg, statusFilter, scope]);
  const types = useVenueTypes();
  const places = useMemo(() => placeOptions(listed), [listed]);
  const typeFilter = category === "festival" ? [] : venueType; // venue types mean nothing to festivals: the filter hides
  // Venues: whether a venue is being pitched (#82 Q1, what the Pitch List used to answer) and in which campaign.
  const [pitching, setPitching] = useState<PitchingFilter>("");
  const rows = useMemo(() => seg === "venues" ? listed.filter((r) => pitchingMatch(r, pitching, live)) : seg !== "pitches" ? listed : listed.filter((r) =>
    (!category || CATEGORY_KINDS[category].includes(r.kind)) && (!place.length || r.places.some((p) => placeKeys(p).some((k) => place.includes(k)))) && (!typeFilter.length || typeFilter.includes(r.venueType ?? "")),
  ), [listed, seg, category, place, typeFilter, pitching, live]);
  const filtering = !!((status && status !== (camp?.status === "closed" ? "all" : "")) || category || place.length || typeFilter.length);
  const scoped = useMemo(() => scope ? b.pitches.filter(scope) : [], [b.pitches, scope]);
  // The email columns read every thread of the band once (#82 S7): admins only, like the rules.
  const { artistId } = useArtist();
  const threads = useCollection<EmailThread>("emailThreads", { where: [["artistId", "==", artistId]], skip: seg !== "pitches" }).rows as ThreadLike[] | undefined; // Firestore hands back Timestamps
  // Write emails (#82 S9): the active pitches with no email yet (To Pitch or Future Pitch), and those whose follow-up is due.
  const queues = useMemo(() => {
    const initial: QueueItem[] = [], followUp: QueueItem[] = [];
    if (!threads) return { initial, followUp };
    const today = todayStr();
    for (const p of scoped) {
      if (!isActive(p.status)) continue;
      const place = p.target.kind === "edition" ? b.editions.find((e) => e.id === p.target.id)?.festivalId ?? p.target.id : p.target.id;
      const c = emailCells(p, threads, place, today);
      if (!c.initial && (p.status === "toPitch" || p.status === "idea")) initial.push({ pitchId: p.id });
      else if (c.followUp?.kind === "due") followUp.push({ pitchId: p.id, ...(c.followUp.threadId ? { threadId: c.followUp.threadId } : {}) });
    }
    return { initial, followUp };
  }, [scoped, threads, b.editions]);

  // Festivals tab: the server searches, sorts and pages it (festivals.page); the rows are drawn from the live data in that order.
  const [sort, setSortState] = useState<FestivalSort>(() => {
    const s = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("sort");
    return (FESTIVAL_SORTS as readonly string[]).includes(s ?? "") ? (s as FestivalSort) : "name";
  });
  const setSort = (s: FestivalSort) => {
    setSortState(s);
    const carried = new URLSearchParams(window.location.search).get("campaign");
    const qs = new URLSearchParams({ ...(q.trim() ? { q } : {}), ...(s !== "name" ? { sort: s } : {}), ...(carried ? { campaign: carried } : {}) }).toString();
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
  const [renaming, setRenaming] = useState(0); // ⋮ › Rename opens the title's editor
  const carry = campaign && campaign !== ONGOING ? `?campaign=${encodeURIComponent(campaign)}` : "";
  // A flag asks which campaign first (once per page, #82 S6), then opens the pitch form.
  const fc = useFlagCampaign();
  const flag = async (t: PitchTarget) => { if (await fc.ask()) setTarget(t); };
  // Pitch List selection (admins; local, not saved): the pitch ids ticked for "Add to a tour" / "Make a tour".
  const [picked, setPicked] = useState<string[]>([]);
  const [tourOpen, setTourOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [note, setNote] = useState("");
  const chosen = b.pitches.filter((p) => picked.includes(p.id));
  const togglePick = (id: string) => setPicked((x) => x.includes(id) ? x.filter((y) => y !== id) : [...x, id]);

  async function create(kind: Exclude<Add, null>, data: Record<string, unknown>, meta: SubmitMeta) {
    const cmd = { venue: "venues.create", promoter: "promoters.create", festival: "festivals.create", act: "acts.create" }[kind];
    const r = await call<{ id: string }>(cmd, data, meta);
    if (r) router.push(hrefFor(kind, r.id));
    return !!r;
  }
  const forms = { venue: venueForm, promoter: promoterForm, festival: festivalForm, act: actForm };

  const addActions = (
    <Menu label="New booking record" testid="booking-add" triggerClass="btn acc" trigger={<span className="px-1 font-semibold">+ New ▾</span>}
      items={(["venue", "promoter", "festival", "act"] as const).map((k) => ({
        key: k, testid: `add-${k}`, label: `New ${k === "festival" ? "festival or series" : k}`,
        onSelect: () => setAdd(add === k ? "none" : k),
      }))} />
  );
  const form = add && (
    <>
    <EntityForm key={add} testid={`new-${add}`} fields={forms[add].fields} initial={forms[add].blank} build={forms[add].build}
      submitLabel={`Create ${add}`} onSubmit={(d, meta) => create(add, d, meta)} onCancel={() => setAdd("none")}
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
        actions={<button className="btn acc" data-testid="add-venue" onClick={() => setAdd(add === "venue" ? "none" : "venue")}>+ New venue</button>}>
        <ErrorBox error={error} />
        {form}
      </WelcomeEmpty>
    );
  }

  return (
    <div className="grid gap-5">
      {campaign && campaign !== ONGOING && !b.loading && !camp && <div className="empty" data-testid="campaign-not-found"><span>That campaign isn&apos;t here any more. <Link href={ROUTES.bookingCampaigns.path}>All campaigns</Link></span></div>}
      <PageTitle back={campaign ? <Crumbs fixed items={[{ label: ROUTES.bookingCampaigns.title, href: ROUTES.bookingCampaigns.path }, { label: camp?.name ?? ROUTES.bookingPitches.title }]} />
        : fromCampaign ? <Crumbs items={[{ label: ROUTES.bookingCampaigns.title, href: ROUTES.bookingCampaigns.path }, fromCampaign, { label: TITLE[seg] }]} /> : undefined}
        title={camp ? <CampaignName key={renaming} c={camp} start={renaming > 0} /> : campaign ? ROUTES.bookingPitches.title : TITLE[seg]}
        pill={camp?.status === "closed" ? <span className="pill" data-testid="campaign-closed">Closed</span> : undefined}
        center={!campaign} actions={<>
        <label className={campaign ? "search-field narrow" : "search-field"}>
          <SearchIcon />
          <input className="input" type="search" placeholder="Search places, festivals, contacts…" value={q} onChange={(e) => changeQ(e.target.value)} data-testid="booking-search" aria-label="Search booking" />
          {q.trim() && <button type="button" className="search-clear" onClick={() => changeQ("")} data-testid="search-clear">Clear</button>}
        </label>
        {addActions}
        {/* Where to add pitches to this campaign from (was the "Add pitches from" line; Jeff, 2026-11-12). Carries ?campaign=. */}
        {campaign && (!camp || camp.status === "active") && <Menu label="Add pitches from" testid="add-pitches-from" triggerClass="btn" trigger={<span className="px-1 font-semibold">Add ▾</span>} items={[
          { key: "venues", testid: "add-from-venues", label: "From Venues", onSelect: () => router.push(`${ROUTES.bookingVenues.path}${carry}`) },
          { key: "festivals", testid: "add-from-festivals", label: "From Festivals & series", onSelect: () => router.push(`${ROUTES.bookingFestivals.path}${carry}`) },
          { key: "calendars", testid: "add-from-calendars", label: "From Venue calendars", onSelect: () => router.push(`${ROUTES.bookingCalendars.path}${carry}`) },
        ]} />}
        {campaign && <Menu label="Email" testid="campaign-email" triggerClass="btn" trigger={<span className="px-1 font-semibold">Email ▾</span>} items={[
          { key: "initial", testid: "write-emails", label: queues.initial.length ? `Write ${queues.initial.length} ${queues.initial.length === 1 ? "email" : "emails"}` : "Write emails",
            disabled: !queues.initial.length, hint: "Every pitch that needs one has its first email", onSelect: () => router.push(queueHref(queues.initial, 0, base)!) },
          { key: "followUp", testid: "write-follow-ups", label: queues.followUp.length ? `Write ${queues.followUp.length} ${queues.followUp.length === 1 ? "follow-up" : "follow-ups"}` : "Write follow-ups",
            disabled: !queues.followUp.length, hint: "No follow-up is due", onSelect: () => router.push(queueHref(queues.followUp, 0, base)!) },
          // Pitches emailed outside Roadie (by hand, from Gmail): find what was sent and link it.
          { key: "find", testid: "find-sent-emails", label: "Find sent emails", onSelect: () => router.push(`${ROUTES.emailFind.path}?campaign=${encodeURIComponent(campaign)}`) },
        ]} />}
        {camp && <Menu label="Campaign actions" testid="campaign-more" triggerClass="btn" trigger={<span className="px-1 text-lg font-bold leading-none" aria-hidden>⋮</span>} items={[
          { key: "rename", testid: "campaign-rename", label: "Rename", onSelect: () => setRenaming((n) => n + 1) },
          camp.status === "active"
            ? { key: "close", testid: "campaign-close", label: "Close campaign", danger: true, onSelect: () => { if (confirm(`Close ${camp.name}? Its pitches stay in it, and the active ones show under Ongoing until you reopen it.`)) void call("campaigns.close", { id: camp.id }); } }
            : { key: "reopen", testid: "campaign-reopen", label: "Reopen", onSelect: () => void call("campaigns.reopen", { id: camp.id }) },
        ]} />}
      </>} />
      <ErrorBox error={error} />

      {seg === "pitches" && !q.trim() && (
        <div className="pitch-filter flex flex-wrap items-center gap-2" data-testid="pitch-filter">
          <span className="s font-semibold whitespace-nowrap">Filter by</span>
          <select className="select w-auto" value={status} onChange={(e) => setStatus(e.target.value as Status | "" | "all")} aria-label="Filter pitches by status" data-testid="pitch-status-filter">
            <option value="">All active</option>
            <option value="all">All statuses</option>
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
      {(seg === "venues" || seg === "festivals") && !q.trim() && (
        <div className="pitch-filter flex flex-wrap items-center gap-x-4 gap-y-2 justify-self-start" data-testid="venue-filter">
          {seg === "venues" && <span className="flex flex-wrap items-center gap-2">
          <span className="s font-semibold whitespace-nowrap">Filter by</span>
          <select className="select w-auto" value={pitching} onChange={(e) => setPitching(e.target.value as PitchingFilter)} aria-label="Filter venues by pitch or campaign" data-testid="venue-pitching-filter">
            <option value="">All venues</option>
            <option value="pitched">Being pitched</option>
            <option value="unpitched">Not being pitched</option>
            <optgroup label="Being pitched in">
              <option value={ONGOING}>{ROUTES.bookingPitches.title}</option>
              {[...live.values()].filter((c) => c.status === "active").sort((a, c) => a.name.localeCompare(c.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          </select>
          </span>}
          <FlagCampaignSelect />
        </div>
      )}
      {q.trim() ? <SearchBuckets q={q} ours={ours} onFlag={(t) => void flag(t)} onLeave={() => setQ("")} /> : seg === "calendars" ? <VenueCalendars /> : seg === "acts" ? <ActsTab /> : <>
      <div className="grid min-w-0 gap-3" data-testid={seg === "pitches" ? "pitch-list" : "booking-list"}>
        {seg === "festivals" && <ErrorBox error={page.error} />}
        {listLoading && <span className="s">Loading…</span>}
        {!listLoading && shownRows.length === 0 && (seg === "pitches" && !q.trim() && !filtering
          ? <div className="empty" data-testid="campaign-empty"><span>{camp ? "Nothing in this campaign yet. Add pitches from Venues, Festivals & series or Venue calendars." : "Nothing in Ongoing. Tap a flag on Venues, Festivals & series or Venue calendars to add something."}</span></div>
          : <div className="empty" data-testid="no-results"><span>Nothing matches.</span></div>)}
        {seg === "pitches" && chosen.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[#1c1b22] px-3 py-2 text-white" data-testid="selection-bar">
            <b className="mr-auto" data-testid="selection-count">{chosen.length} {chosen.length === 1 ? "pitch" : "pitches"} selected</b>
            <button type="button" className="btn acc" onClick={() => setMoveOpen(true)} data-testid="selection-move-campaign">Move to a campaign</button>
            <button type="button" className="btn" onClick={() => setTourOpen(true)} data-testid="selection-add-to-tour">Add to a tour</button>
            <button type="button" className="btn" onClick={() => router.push(`/tours/new?pitchIds=${chosen.map((p) => p.id).join(",")}`)} data-testid="selection-make-tour">Make a tour</button>
          </div>
        )}
        {note && <p className="s" role="status" data-testid="selection-note">{note}</p>}
        {shownRows.length > 0 && <div className="book-tw"><BookingTable seg={listSeg} rows={shownRows} onFlag={(t) => void flag(t)} sort={sort} onSort={setSort} selected={seg === "pitches" ? picked : undefined} onSelect={togglePick} campaigns={live} group={seg === "pitches"} threads={threads} weKnow={weKnow} /></div>}
        {shownRows.length > 0 && CAPTION[listSeg] && <p className="s" data-testid="table-caption">{CAPTION[listSeg]}</p>}
        {seg === "festivals" && page.hasMore && (
          <button type="button" className="btn ghost justify-self-center" disabled={page.loadingMore} onClick={() => void page.more()} data-testid="festivals-more">
            {page.loadingMore ? "Loading…" : `Load more (${page.total - (page.rows?.length ?? 0)} left)`}
          </button>
        )}
      </div>
      </>}
      <AddToTourDialog open={tourOpen} onClose={() => setTourOpen(false)} pitches={chosen}
        onDone={(m) => { setNote(m); setPicked([]); }} />
      <MoveToCampaignDialog open={moveOpen} onClose={() => setMoveOpen(false)} pitchIds={chosen.map((p) => p.id)} from={campaign}
        onDone={(m) => { setNote(m); setPicked([]); }} />
      <PitchModal target={target} onClose={() => setTarget(null)} />
      {form}
    </div>
  );
}

/** A campaign's name as its page title: click to rename (campaigns.rename). */
function CampaignName({ c, start }: { c: Campaign; /** Opened from ⋮ › Rename. */ start?: boolean }) {
  const { call, error } = useCommand();
  return <InlineValue testid="campaign-name" label="Campaign name" kind="text" value={c.name} canEdit enterSaves error={error} autoStart={start}
    validate={(v) => (v.trim() ? null : "A campaign needs a name")} onSave={async (v) => v.trim() === c.name || !!(await call("campaigns.rename", { id: c.id, name: v.trim() }))} />;
}

/** ?campaign= rides along when a page rebuilds its URL (#82 S6): it says which campaign new pitches from this page go in. */
const keepCampaign = () => {
  const c = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("campaign");
  return c ? `?campaign=${encodeURIComponent(c)}` : "";
};

/** Venues' pitch filter: "" all, "pitched" / "unpitched" (an active pitch or not), or ONGOING / a campaign id (its active pitch is there). */
type PitchingFilter = "" | "pitched" | "unpitched" | CampaignKey;
function pitchingMatch(r: ListRow, f: PitchingFilter, live: ReadonlyMap<string, Campaign>): boolean {
  if (!f) return true;
  if (f === "pitched") return !!r.pitch;
  if (f === "unpitched") return !r.pitch;
  return !!r.pitch && homeOf(r.pitch, live) === f;
}

/** Each section's page title: its name in the sub-nav. */
const TITLE: Record<Tab, string> = {
  pitches: ROUTES.bookingPitches.title, venues: ROUTES.bookingVenues.title, festivals: ROUTES.bookingFestivals.title,
  promoters: ROUTES.bookingPromoters.title, calendars: ROUTES.bookingCalendars.title, acts: ROUTES.bookingActs.title,
};

/** The muted line under each section's table (not the search buckets). */
const CAPTION: Partial<Record<Seg, string>> = {
  pitches: "Names and flags open the pitch. Yellow rows have gone quiet.",
  venues: "A venue with an active pitch opens the pitch; the venue page is one click under its name. Venues your band has something on come first.",
  festivals: "A year with an active pitch opens the pitch; the festival page is one click under its name.",
  promoters: "A promoter with an active pitch opens the pitch; the promoter page is one click under its name.",
};

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
const SORT_BY: Record<string, "name" | "deadline" | "date"> = { Festival: "name", Edition: "date", Deadline: "deadline" }; // the dates sit under the year
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
export function BookingTable({ seg, rows, onFlag, sort = "name", onSort, q = "", compact = false, selected, onSelect, campaigns, group = false, threads, weKnow }: { seg: Seg; rows: ListRow[]; onFlag(t: PitchTarget): void; sort?: FestivalSort; onSort?(s: FestivalSort): void; q?: string; compact?: boolean; /** Pitch List: pitch ids ticked, and the toggle (admins). Without them there is no checkbox column. */ selected?: string[]; onSelect?(pitchId: string): void; /** The band's live campaigns: Venues and Festivals get a Campaign column (#82). */ campaigns?: ReadonlyMap<string, Campaign>; /** Campaign pages: venues nest under their promoter (#82 S5). */ group?: boolean; /** Campaign pages: the band's email threads, for the email columns (#82 S7). */ threads?: readonly ThreadLike[]; /** Venue ids with someone we know (#82 S10): their rows get the chip. */ weKnow?: Set<string> }) {
  const hl = (text: string): ReactNode => {
    if (!q.trim()) return text;
    const h = highlight(text, q);
    return h.match ? <>{h.before}<mark>{h.match}</mark>{h.after}</> : text;
  };
  const router = useRouter();
  const artist = useArtist();
  const configs = artist.doc?.configurations ?? [];
  const fc = useFlagCampaign();
  const { call: callMove, busy: moving } = useCommand();
  // In-place edits on a campaign page: status, lineup, next step; Write follow-up opens a modal (#82, Jeff 2026-11-12).
  const { call: edit, error: editError } = useCommand();
  const [followUp, setFollowUp] = useState<{ pitch: PitchRow; threadId?: string } | null>(null);
  const move = (pitchId: string, into: CampaignKey) => callMove("pitches.setCampaign", { ids: [pitchId], campaignId: into === ONGOING ? null : into });
  const flagged = seg !== "contacts";
  const wideName = seg === "venues" || seg === "festivals";
  // compact (search buckets) drops Phone, and on festivals Email and Pitch too.
  // Venues and Festivals (#82): one Campaign column, first, holds the campaign and the pitch's lineup and dates (was Pitch + Campaign).
  // Festivals put the city under the festival and the dates under the year.
  const campCol = !!campaigns && !compact && (seg === "venues" || seg === "festivals");
  const heads: string[] = seg === "venues" ? [...(campCol ? ["Campaign"] : []), "Name", "City", "Email", ...(compact ? [] : ["Phone"]), ...(campCol ? [] : ["Pitch"])]
    : seg === "festivals" ? [...(campCol ? ["Campaign"] : []), "Festival", "Edition", "Deadline", ...(compact ? [] : ["Email", "Phone"]), ...(compact || campCol ? [] : ["Pitch"])]
    : seg === "promoters" ? ["Promoter", "Name", "City", "Email", ...(compact ? [] : ["Phone"]), "Pitch"]
    : seg === "contacts" ? ["Name", "Organization", "City", "Email", "Phone"]
    : ["Name", "Initial email", "Follow-up", "Status", "Next step"]; // a campaign page (#82 S7)
  const today = todayStr();
  // Pitch List: Pitched or Talking with no contact (or, never contacted, since it was added) for QUIET_DAYS turns the row yellow.
  const quiet = (r: ListRow) => {
    const p = r.pitch;
    return seg === "pitches" && !!p && (quietDays(p.status, (p.lastContactAt ?? p.createdAt)?.toMillis(), today) ?? 0) >= QUIET_DAYS;
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
  // Where the row's pitch is: its campaign (linked), or Ongoing.
  const campaignCell = (r: ListRow) => {
    const k = r.pitch && campaigns ? homeOf(r.pitch, campaigns) : null;
    const into = fc.chosen;
    const t = r.pitch ? pitchCellText(r.pitch, configs) : null;
    return <td className="nw" data-testid={`campaign-cell-${r.id}`}>{!k ? <Dash /> : k === ONGOING
      ? <Link href={ROUTES.bookingPitches.path}>{ROUTES.bookingPitches.title}</Link>
      : <Link href={`/booking/campaigns/${k}`}>{campaigns!.get(k)?.name}</Link>}
      {t && <span className="sub" data-testid={`pitch-cell-${r.id}`}>{t.config} · {t.dates}</span>}
      {/* The page's campaign is chosen and this pitch is elsewhere: one click moves it (#82 S6). */}
      {k && into && into !== k && <span className="sub"><button type="button" className="link cursor-pointer border-0 bg-transparent p-0 text-[0.8125rem]" disabled={moving}
        onClick={() => void move(r.pitch!.id, into)} data-testid={`move-to-${r.id}`}>Move to {fc.label(into)}</button></span>}</td>;
  };
  const reach = (r: ListRow) => (<>
    {!(compact && seg === "festivals") && <td>{r.email ? <a className="em" href={`mailto:${r.email}`}>{hl(r.email)}</a> : <Dash />}</td>}
    {!(compact && seg !== "contacts") && <td className="nw">{r.phone ? <a className="ph" href={`tel:${r.phone}`}>{fmtPhone(r.phone)}</a> : <Dash />}</td>}
  </>);
  const city = (r: ListRow) => <td className="nw">{r.city || <Dash />}</td>;
  const nextStep = (r: ListRow) => {
    const p = r.pitch, n = p?.nextStep;
    if (!p || seg !== "pitches") return <td className="ns" data-testid={`next-step-${r.id}`}>{n ? <>{n.text}<span className="sub">by {fmtDate(n.due)}</span></> : <Dash />}</td>;
    // Click to edit, as on the pitch page (#82, Jeff 2026-11-12). A new step is due a week out until its date is changed; clearing the words clears it.
    return (
      <td className="ns" data-testid={`next-step-${r.id}`}>
        <InlineValue testid={`next-text-${r.id}`} label="Next step" kind="text" value={n?.text ?? ""} canEdit enterSaves error={editError} emptyLabel="Add a next step"
          onSave={async (v) => { const t = v.trim(); if (t === (n?.text ?? "")) return true;
            return !!(await edit("pitches.update", { id: p.id, patch: { nextStep: t ? { text: t, due: n?.due ?? weekOut() } : null } })); }} />
        {n && <span className="sub"><InlineValue testid={`next-due-${r.id}`} label="Next step date" kind="date" value={n.due} display={`by ${fmtDate(n.due)}`} canEdit error={editError}
          onSave={async (v) => !v || v === n.due || !!(await edit("pitches.update", { id: p.id, patch: { nextStep: { text: n.text, due: v } } }))} /></span>}
      </td>
    );
  };
  const nameCell = (r: ListRow, child = false) => (
    <td className={child ? "name child" : "name"}>
      {seg === "pitches" ? <><Link href={r.pitch ? `/booking/pitches/${r.pitch.id}` : hrefFor(r.to.kind, r.to.id)} className="nm" data-testid={`${r.kind}-full-${r.id}`}>{hl(r.name)}</Link>
        <span className="sub">{[r.type, r.city].filter(Boolean).join(" · ")}
          {r.pitch && <> · <InlineValue testid={`lineup-${r.id}`} label="Lineup" kind="select" value={r.pitch.pitchedAs ?? ""} canEdit error={editError}
            display={configs.find((c) => c.id === r.pitch!.pitchedAs)?.name ?? "Not sure yet"} options={[["", "Not sure yet"], ...configs.map((c) => [c.id, c.name] as const)]}
            onSave={async (v) => v === (r.pitch!.pitchedAs ?? "") || !!(await edit("pitches.update", { id: r.pitch!.id, patch: { pitchedAs: v || null } }))} /></>}</span></>
        : <>{nameLink(r, r.to, `${r.kind}-full-${r.id}`, "Venue page")}{status(r)}</>}
      {r.kind === "venue" && weKnow?.has(r.id) && <> <WeKnowChip id={r.id} /></>}
      {r.promoters.length > 0 && !child && <span className="sub">promoted by {r.promoters.map((p, i) => <span key={p.id}>{i > 0 && ", "}<Link href={hrefFor("promoter", p.id)}>{p.name}</Link></span>)}</span>}
    </td>
  );

  // Campaign pages (#82 S7): Initial email, Follow-up, Status (+ New reply), from the band's emailThreads and the pitch.
  const cellsOf = (r: ListRow) => r.pitch ? emailCells(r.pitch, threads ?? [], r.kind === "edition" ? r.festival!.id : r.id, today) : null;
  /** The three email cells of a row: Initial email, Follow-up, Status. `same`: a venue whose group row shows the shared email. */
  const emailParts = (r: ListRow, same = false): [ReactNode, ReactNode, ReactNode] => {
    const p = r.pitch, c = cellsOf(r);
    const f = c?.followUp;
    const status = <td key="st" className="nw" data-testid={`status-${r.id}`}>{p && <InlineValue testid={`status-edit-${r.id}`} label="Status" kind="select" value={p.status} canEdit error={editError}
      display={<StatusChip status={p.status} />} options={STATUSES.map((st) => [st, STATUS_LABEL[st]] as const)}
      onSave={async (v) => v === p.status || !!(await edit("pitches.move", { id: p.id, status: v }))} />}{c?.newReply && <> <span className="chip a" data-testid={`new-reply-${r.id}`}>New reply</span></>}</td>;
    // A venue under a promoter whose one email covers the whole group: the group row shows it once (#82 S8b).
    if (same) return [<td key="in" className="nw"><span className="sub italic">Same email</span></td>, <td key="fu" className="nw"><span className="sub italic">Same email</span></td>, status];
    const threadLink = (id: string, subject: string, testid: string) => <Link href={`/booking/email/${id}`} className="sub block max-w-[220px] truncate" data-testid={testid}>{subject || "(no subject)"}</Link>;
    return [
      <td key="in" className="nw" data-testid={`initial-email-${r.id}`}>{c?.initial
        ? <><b>{fmtDate(c.initial.date)}</b>{threadLink(c.initial.threadId, c.initial.subject, `initial-thread-${r.id}`)}</>
        : p && (p.status === "toPitch" || p.status === "idea") ? <Link href={`/booking/email/new?pitch=${p.id}`} className="font-semibold" data-testid={`write-initial-${r.id}`}>Write it</Link>
        : p && isActive(p.status) ? <span className="sub" title="Sent before Roadie, or from Gmail without linking it">Not in Roadie</span> : <Dash />}</td>,
      <td key="fu" className="nw" data-testid={`follow-up-${r.id}`}>{!f ? <Dash />
        : f.kind === "sent" ? <><b>{fmtDate(f.date)}</b>{f.newThread && <> <span className="chip" title="Sent as a new email, not a reply in the first thread">new thread</span></>}{f.more > 0 && <span className="s"> +{f.more}</span>}{threadLink(f.threadId, f.subject, `follow-up-thread-${r.id}`)}</>
        : f.kind === "replied" ? <span className="sub">Not needed: replied {fmtDate(f.date)}</span>
        : <><span className="chip y" data-testid={`follow-up-due-${r.id}`}>{f.due ? `Due ${fmtDate(p!.nextStep!.due!)}` : `${f.days} days quiet`}</span>
          <button type="button" className="link sub cursor-pointer border-0 bg-transparent p-0 text-left font-semibold" onClick={() => setFollowUp({ pitch: p!, threadId: f.threadId })} data-testid={`write-follow-up-${r.id}`}>Write follow-up</button></>}</td>,
      status,
    ];
  };
  const emailTds = (r: ListRow, same = false) => <>{emailParts(r, same)}</>;

  const rowEl = (r: ListRow, child = false, same = false) => (
          <tr key={`${r.kind}:${r.id}`} data-testid={`row-${r.kind}-${r.id}`} data-quiet={quiet(r) ? "1" : undefined} data-child={child ? "1" : undefined}>
            {selected && <td className="flag">{r.pitch && <input type="checkbox" className="h-[18px] w-[18px]" checked={selected.includes(r.pitch.id)}
              onChange={() => onSelect?.(r.pitch!.id)} aria-label={`Select ${r.name}`} data-testid={`pitch-select-${r.pitch.id}`} />}</td>}
            {flagged && flag(r)}
            {campCol && campaignCell(r)}
            {seg === "festivals" ? (<>
              <td className="name">{link(r.festival!, r.kind === "festival" ? `festival-full-${r.id}` : `festival-name-${r.id}`)}{r.city && <span className="sub" data-testid={`festival-city-${r.id}`}>{r.city}</span>}</td>
              <td className="nw">{r.edition ? <>{nameLink(r, r.edition, `edition-full-${r.id}`)}{status(r)}</> : <Link href={`/booking/festivals/${r.id}?addEdition=1`} className="nm" data-testid={`add-edition-${r.id}`}>+ New year</Link>}
                {r.startDate && <span className="sub" data-testid={`dates-${r.id}`}>{fmtDate(r.startDate)}{r.endDate && r.endDate !== r.startDate ? `–${fmtDate(r.endDate)}` : ""}</span>}</td>
              <td className="nw" data-testid={`deadline-${r.id}`}>{r.deadline ? <>{fmtDate(r.deadline.date)}{r.deadline.sure !== "confirmed" && <span className="s" title={r.deadline.sure === "target" ? "Our target" : "Estimated"}> {r.deadline.sure === "target" ? "(target)" : "(est.)"}</span>}</> : <Dash />}</td>
            </>) : seg === "promoters" ? (<>
              <td>{nameLink(r, r.to, `promoter-full-${r.id}`, "Promoter page")}{status(r)}</td>
              <td>{r.person ?? <Dash />}</td>
            </>) : seg === "contacts" ? (<>
              <td>{link(r.to, `contact-full-${r.id}`)}</td>
              <td>{r.organization ? link(r.organization) : <Dash />}</td>
            </>) : (<>
              {nameCell(r, child)}
            </>)}
            {seg === "pitches" ? emailTds(r, same) : <>
              {seg !== "festivals" && city(r)}
              {reach(r)}
              {seg !== "contacts" && !(compact && seg === "festivals") && !campCol && pitchCell(r)}
            </>}
            {seg === "pitches" && nextStep(r)}
          </tr>
  );
  /** The one thread every venue in a group shares as its initial email, if they all do (#82 S8b). */
  const sharedThread = (g: Extract<Grouped<ListRow>, { type: "group" }>): ListRow | null => {
    if (g.children.length < 2) return null;
    const firsts = g.children.map((c) => cellsOf(c)?.initial?.threadId);
    return firsts[0] && firsts.every((x) => x === firsts[0]) ? g.children[0] : null;
  };
  // A promoter group (#82 S5): ticks every pitch in it, rolls up their statuses; the promoter's own pitch, if any, fills the row.
  const groupEl = (g: Extract<Grouped<ListRow>, { type: "group" }>) => {
    const own = g.own;
    const shared = sharedThread(g);
    const childIds = g.children.flatMap((c) => (c.pitch && isActive(c.pitch.status) ? [c.pitch.id] : []));
    const lead = own?.pitch?.id ?? childIds[0];
    const oneEmail = lead && `/booking/email/new?target=promoter:${g.promoter.id}&pitch=${lead}&pitches=${childIds.filter((x) => x !== lead).join(",")}`;
    const ids = [...(own?.pitch ? [own.pitch.id] : []), ...g.children.flatMap((c) => (c.pitch ? [c.pitch.id] : []))];
    const allOn = !!selected && ids.length > 0 && ids.every((x) => selected.includes(x));
    const cities = [...new Set(g.children.map((c) => c.city).filter(Boolean))].join(", ");
    const all = [...(own?.pitch ? [own.pitch] : []), ...g.children.flatMap((c) => (c.pitch ? [c.pitch] : []))];
    return (
      <tr key={`group:${g.promoter.id}`} className="grp" data-testid={`group-${g.promoter.id}`} data-quiet={own && quiet(own) ? "1" : undefined}>
        {selected && <td className="flag"><input type="checkbox" className="h-[18px] w-[18px]" checked={allOn} aria-label={`Select every ${g.promoter.name} pitch`}
          onChange={() => ids.forEach((x) => { if (allOn || !selected.includes(x)) onSelect?.(x); })} data-testid={`group-select-${g.promoter.id}`} /></td>}
        {flagged && (own ? flag(own) : <td className="flag" />)}
        <td className="name">
          <span className="flex flex-wrap items-center gap-1.5">
            <Link href={own?.pitch ? `/booking/pitches/${own.pitch.id}` : hrefFor("promoter", g.promoter.id)} className="nm" data-testid={`group-name-${g.promoter.id}`}>{hl(g.promoter.name)}</Link>
            <span className="chip">Promoter</span>
          </span>
          <span className="sub">{g.children.length} {g.children.length === 1 ? "venue" : "venues"}{cities ? ` · ${cities}` : ""}{own ? " · and the promoter's own pitch" : ""}</span>
        </td>
        {shared ? emailParts(shared).slice(0, 2)
          : own ? emailParts(own).slice(0, 2)
          : <><td className="nw">{oneEmail && childIds.length > 1 && <Link href={oneEmail} className="font-semibold" data-testid={`group-write-${g.promoter.id}`}>Write one email</Link>}</td><td /></>}
        {/* The group's roll-up sits in Status like any row's status, as plain text (Jeff, 2026-11-12). */}
        <td className="nw" data-testid={`group-roll-${g.promoter.id}`}>{statusCounts(all).map(({ status: st, n }) => `${n} ${STATUS_LABEL[st]}`).join(", ")}</td>
        {own ? nextStep(own) : <td className="ns"><Dash /></td>}
      </tr>
    );
  };

  return (<>
    <table className={wideName ? "book-table wn" : seg === "pitches" ? "book-table camp" : "book-table"}>
      <thead><tr>
        {selected && <th className="flag" aria-label="Select" />}
        {flagged && <th className="flag" aria-label="Pitch List flag" />}
        {heads.map((h, i) => {
          const sortBy = seg === "festivals" && onSort ? SORT_BY[h] : undefined;
          const on = sortBy && sort.replace("-", "") === sortBy;
          return (
            <th key={h} className={h === "Pitch" ? "pitch" : h === "Last contact" ? "lc" : h === "Next step" ? "ns" : seg === "pitches" && h === "Name" ? "name" : wideName && (h === "Name" || h === "Festival" || (i === 0 && h !== "Campaign")) ? "name" : h === "Deadline" || h === "Campaign" ? "nw" : undefined}
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
        {(group ? groupByPromoter(rows) : rows.map((row) => ({ type: "row" as const, row }))).map((g) => g.type === "row" ? rowEl(g.row) : (
          <Fragment key={`group:${g.promoter.id}`}>
            {groupEl(g)}
            {g.children.map((r) => rowEl(r, true, sharedThread(g) !== null))}
          </Fragment>
        ))}
      </tbody>
    </table>
    {seg === "pitches" && <FollowUpDialog pitch={followUp?.pitch ?? null} threadId={followUp?.threadId} onClose={() => setFollowUp(null)} />}
  </>);
}
