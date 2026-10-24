"use client";
import { draftPath } from "@/schema/drafts";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { useMemo, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection } from "@/lib/firestore-hooks";
import { useHasDraft } from "@/lib/drafts";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";
import {
  EntityForm, Flagged, PitchDates, Tabs, StatusChip, contactForm, type SubmitMeta, festivalForm, hrefFor, promoterForm, useBooking, venueForm, type PitchRow,
} from "@/components/booking/common";
import { STATUSES, STATUS_LABEL, appsOpenThisMonth, buildSearchItems, fmtDate, searchItems, todayStr } from "@/lib/booking";
import type { Show, User } from "@/schema";

/** The booking index. Each tab has its own route (/booking, /booking/pitches, /booking/venues, …) so it can be linked to. */
export function BookingIndex({ seg }: { seg: Seg }) { return <AdminOnly><Booking seg={seg} /></AdminOnly>; }

export type Seg = "all" | "pitches" | "venues" | "festivals" | "promoters" | "contacts";
type Add = null | "venue" | "promoter" | "festival" | "contact";
interface ListRow { key: string; kind: "venue" | "promoter" | "festival" | "edition" | "contact"; id: string; title: string; sub: string; ownerId: string }

function Booking({ seg }: { seg: Seg }) {
  const router = useRouter();
  const b = useBooking();
  const { call, error } = useCommand();
  // The search survives switching tabs: it rides along as ?q= on the tab's route.
  const [q, setQ] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("q") ?? ""));
  const setSeg = (s: Seg) => router.push(`/booking${s === "all" ? "" : `/${s}`}${q.trim() ? `?q=${encodeURIComponent(q)}` : ""}`);
  // An unfinished "new X" opens its form by itself (Home's Unfinished card links here).
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

  const rows = useMemo(() => {
    const items = searchItems(buildSearchItems(b), q);
    const hit = new Set(items.map((i) => `${i.kind}:${i.id}`));
    const searching = q.trim().length > 0;
    const all: ListRow[] = [];
    const sorted = <T extends { name: string }>(x: T[]) => [...x].sort((a, c) => a.name.localeCompare(c.name));
    const venuesFirst = [...sorted(b.venues)].sort((x, y) => Number(ours.has(y.id)) - Number(ours.has(x.id)));
    for (const v of venuesFirst) all.push({ key: `venue:${v.id}`, kind: "venue", id: v.id, ownerId: v.id, title: v.name, sub: ["Venue", v.address.city, v.capacity].filter(Boolean).join(" · ") });
    for (const p of sorted(b.promoters)) all.push({ key: `promoter:${p.id}`, kind: "promoter", id: p.id, ownerId: p.id, title: p.name, sub: `Promoter · ${p.venueIds.length} venue${p.venueIds.length === 1 ? "" : "s"}` });
    for (const f of sorted(b.festivals)) {
      all.push({ key: `festival:${f.id}`, kind: "festival", id: f.id, ownerId: f.id, title: f.name, sub: f.type === "series" ? "Series" : "Festival" });
      for (const e of b.editions.filter((x) => x.festivalId === f.id).sort((x, y) => y.year - x.year)) {
        all.push({ key: `edition:${e.id}`, kind: "edition", id: e.id, ownerId: f.id, title: `${f.name} ${e.label}`,
          sub: `${f.type === "series" ? "Series" : "Festival"}${e.startDate ? ` · ${fmtDate(e.startDate)}${e.endDate && e.endDate !== e.startDate ? `–${fmtDate(e.endDate)}` : ""}` : ""}` });
      }
    }
    for (const c of sorted(b.contacts)) all.push({ key: `contact:${c.id}`, kind: "contact", id: c.id, ownerId: c.id, title: c.name, sub: ["Contact", c.title].filter(Boolean).join(" · ") });
    const inSeg = (r: ListRow) =>
      seg === "venues" ? r.kind === "venue" : seg === "promoters" ? r.kind === "promoter" : seg === "contacts" ? r.kind === "contact"
        : seg === "festivals" ? r.kind === "festival" || r.kind === "edition"
        : seg === "all" ? (searching || (r.kind !== "contact" && r.kind !== "festival")) : false;
    // editions follow their festival's match, so searching "UMS" shows the festival and its years
    return all.filter((r) => inSeg(r) && (!searching || hit.has(`${r.kind === "edition" ? "festival" : r.kind}:${r.ownerId}`)));
  }, [b.venues, b.promoters, b.festivals, b.editions, b.contacts, ours, q, seg]);

  const open = appsOpenThisMonth(b.editions);
  const users = useCollection<User>("users");
  const userName = (id?: string) => users.rows?.find((u) => u.id === id)?.name;
  const pitchesFiltered = q.trim() ? b.pitches.filter((p) => p.target.name.toLowerCase().includes(q.toLowerCase())) : b.pitches;

  async function create(kind: Exclude<Add, null>, data: Record<string, unknown>, meta: SubmitMeta) {
    const cmd = { venue: "venues.create", promoter: "promoters.create", festival: "festivals.create", contact: "contacts.create" }[kind];
    const r = await call<{ id: string }>(cmd, data, meta);
    if (r) router.push(hrefFor(kind, r.id));
    return !!r;
  }
  const forms = { venue: venueForm, promoter: promoterForm, festival: festivalForm, contact: contactForm };

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
      <PageTitle title="Booking" />
      <input className="input" type="search" placeholder="Search places, festivals, contacts…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="booking-search" />
      <Tabs<Seg> testid="booking-seg" value={seg} onChange={setSeg}
        options={[["all", "All"], ["pitches", <>Pitch List <span className="chip a ml-1" data-testid="pitch-count">{b.pitches.length}</span></>], ["venues", "Venues"], ["festivals", "Festivals & series"], ["promoters", "Promoters"], ["contacts", "Contacts"]]} />
      <ErrorBox error={error} />

      {open.length > 0 && (
        <div className="card hi" data-testid="apps-open">
          <span className="text-xs font-bold uppercase tracking-wider text-[color:var(--acc-btn)]">Applications open this month</span>
          {open.map((e) => (
            <Link key={e.id} href={hrefFor("edition", e.id)} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1" data-testid={`apps-open-${e.id}`}>
              <b className="text-lg">{e.festivalName} {e.label}</b>
              <span className="s">{[e.appOpens && `Opens ${fmtDate(e.appOpens.date)}`, e.appDeadline && `closes ${fmtDate(e.appDeadline.date)}`].filter(Boolean).join(" · ")}</span>
            </Link>
          ))}
        </div>
      )}

      {seg === "pitches" ? (
        <PitchList pitches={pitchesFiltered} userName={userName} />
      ) : (
        <div className="grid gap-3" data-testid="booking-list">
          {b.loading && <span className="s">Loading…</span>}
          {!b.loading && rows.length === 0 && <div className="empty" data-testid="no-results"><span>Nothing matches.</span></div>}
          {rows.map((r) => {
            const pitch = r.kind === "contact" || r.kind === "festival" ? undefined : activeFor(b.pitches, r.kind, r.id);
            return (
              <div key={r.key} className={`card ${r.kind === "edition" ? "ml-4" : ""}`} data-testid={`row-${r.kind}-${r.id}`}>
                <FlaggedRow kind={r.kind} id={r.id} pitches={b.pitches}>{(flag, flagForm, strip) => (<>
                  <div className="flex items-center justify-between gap-3">
                    <Link href={hrefFor(r.kind, r.id)} className="grid min-w-0 flex-1 gap-0.5 no-underline" data-testid={`${r.kind}-full-${r.id}`}>
                      <b className="truncate text-lg">{r.title}</b><span className="s truncate">{r.sub}</span>
                    </Link>
                    {pitch && <StatusChip status={pitch.status} />}
                    {flag}
                  </div>
                  {flagForm}
                  {strip}
                </>)}</FlaggedRow>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(["venue", "promoter", "festival", "contact"] as const).map((k) => (
          <button key={k} className="btn ghost sm" data-testid={`add-${k}`} onClick={() => setAdd(add === k ? "none" : k)}>+ Add {k === "festival" ? "festival or series" : k === "venue" ? "a place" : k}</button>
        ))}
        <Link href="/booking/templates" className="btn ghost sm" data-testid="templates-link">Email templates</Link>
      </div>
      {form}
    </div>
  );
}

const activeFor = (pitches: PitchRow[], kind: string, id: string) =>
  pitches.find((p) => p.target.kind === kind && p.target.id === id && !["declined", "dropped"].includes(p.status));

/** Venue, promoter and edition rows have a flag; festivals and contacts don't. */
function FlaggedRow({ kind, id, pitches, children }: { kind: string; id: string; pitches: PitchRow[]; children(button: React.ReactNode, form: React.ReactNode, strip: React.ReactNode): React.ReactNode }) {
  if (kind !== "promoter" && kind !== "edition" && kind !== "venue") return <>{children(null, null, null)}</>;
  return <Flagged kind={kind} id={id} pitches={pitches} square>{children}</Flagged>;
}

function PitchList({ pitches, userName }: { pitches: PitchRow[]; userName(id?: string): string | undefined }) {
  const today = todayStr();
  return (
    <div className="grid gap-5" data-testid="pitch-list">
      {pitches.length === 0 && <div className="empty"><span>Nothing on the Pitch List. Tap a flag to add something.</span></div>}
      {STATUSES.map((s) => {
        const group = pitches.filter((p) => p.status === s).sort((a, b) => (a.nextStep?.due ?? "9").localeCompare(b.nextStep?.due ?? "9"));
        if (!group.length) return null;
        return (
          <div key={s} className="grid gap-2" data-testid={`group-${s}`}>
            <span className="lbl">{STATUS_LABEL[s]} · {group.length}</span>
            {group.map((p) => (
              <Link key={p.id} href={`/booking/pitches/${p.id}`} className="card" data-testid={`pitch-${p.id}`}>
                <div className="flex items-center justify-between gap-2"><b>{p.target.name}</b><StatusChip status={p.status} /></div>
                <span className="s">{[userName(p.assigneeId), p.nextStep ? `${p.nextStep.text} · ${fmtDate(p.nextStep.due)}` : null].filter(Boolean).join(" · ")}</span>
                <PitchDates dates={p.dates} today={today} testid={`pitch-dates-${p.id}`} />
              </Link>
            ))}
          </div>
        );
      })}
    </div>
  );
}
