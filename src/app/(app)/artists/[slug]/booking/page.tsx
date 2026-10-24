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
import type { User } from "@/schema";

export default function BookingPage() { return <AdminOnly><Booking /></AdminOnly>; }

type Seg = "all" | "pitches" | "venues" | "festivals" | "promoters" | "contacts";
type Add = null | "venue" | "promoter" | "festival" | "contact";
interface ListRow { key: string; kind: "venue" | "promoter" | "festival" | "edition" | "contact"; id: string; title: string; sub: string; ownerId: string }

function Booking() {
  const router = useRouter();
  const b = useBooking();
  const { call, error } = useCommand();
  const [seg, setSeg] = useState<Seg>("all");
  const [q, setQ] = useState("");
  // An unfinished "new X" opens its form by itself (Home's Unfinished card links here).
  const drafts = { venue: useHasDraft(draftPath.newIn("venues")), promoter: useHasDraft(draftPath.newIn("promoters")), festival: useHasDraft(draftPath.newIn("festivals")), contact: useHasDraft(draftPath.newIn("contacts")) };
  const [explicit, setAdd] = useState<Add | "none" | undefined>(undefined);
  const add: Add = explicit === "none" ? null : explicit ?? (["venue", "promoter", "festival", "contact"] as const).find((k) => drafts[k]) ?? null;

  const rows = useMemo(() => {
    const items = searchItems(buildSearchItems(b), q);
    const hit = new Set(items.map((i) => `${i.kind}:${i.id}`));
    const searching = q.trim().length > 0;
    const all: ListRow[] = [];
    const sorted = <T extends { name: string }>(x: T[]) => [...x].sort((a, c) => a.name.localeCompare(c.name));
    for (const v of sorted(b.venues)) all.push({ key: `venue:${v.id}`, kind: "venue", id: v.id, ownerId: v.id, title: v.name, sub: ["Venue", v.address.city, v.capacity].filter(Boolean).join(" · ") });
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
  }, [b.venues, b.promoters, b.festivals, b.editions, b.contacts, q, seg]);

  const open = appsOpenThisMonth(b.editions);
  const users = useCollection<User>("users");
  const userName = (id?: string) => users.rows?.find((u) => u.id === id)?.name;
  const pitchesFiltered = q.trim() ? b.pitches.filter((p) => p.target.name.toLowerCase().includes(q.toLowerCase())) : b.pitches;
  const [expandedVenue, setExpandedVenue] = useState<string | null>(null);

  async function create(kind: Exclude<Add, null>, data: Record<string, unknown>, meta: SubmitMeta) {
    const cmd = { venue: "venues.create", promoter: "promoters.create", festival: "festivals.create", contact: "contacts.create" }[kind];
    const r = await call<{ id: string }>(cmd, data, meta);
    if (r) router.push(hrefFor(kind, r.id));
    return !!r;
  }
  const forms = { venue: venueForm, promoter: promoterForm, festival: festivalForm, contact: contactForm };

  const form = add && (
    <EntityForm key={add} testid={`new-${add}`} fields={forms[add].fields} initial={forms[add].blank} build={forms[add].build}
      submitLabel={`Add ${add}`} onSubmit={(d, meta) => create(add, d, meta)} onCancel={() => setAdd("none")}
      draft={{ path: draftPath.newIn(`${add}s`), title: (v) => `New ${add}${v.name ? ` · ${v.name}` : ""}` }} />
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
    <div className="grid gap-3">
      <PageTitle title="Booking" sub="Everything we could play. The flag adds it to the Pitch List." />
      <input className="input" type="search" placeholder="Search places, festivals, contacts…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="booking-search" />
      <Tabs<Seg> testid="booking-seg" value={seg} onChange={setSeg}
        options={[["all", "All"], ["pitches", "Pitch List"], ["venues", "Venues"], ["festivals", "Festivals & series"], ["promoters", "Promoters"], ["contacts", "Contacts"]]} />
      <ErrorBox error={error} />

      {open.length > 0 && (
        <div className="card hi" data-testid="apps-open">
          <span className="lbl">Applications open this month</span>
          {open.map((e) => (
            <Link key={e.id} href={hrefFor("edition", e.id)} className="flex justify-between gap-2" data-testid={`apps-open-${e.id}`}>
              <b>{e.festivalName} {e.label}</b>
              <span className="s">{e.appOpens ? `opens ${fmtDate(e.appOpens.date)}` : ""}{e.appDeadline ? ` · closes ${fmtDate(e.appDeadline.date)}` : ""}</span>
            </Link>
          ))}
        </div>
      )}

      {seg === "pitches" ? (
        <PitchList pitches={pitchesFiltered} userName={userName} />
      ) : (
        <div className="grid gap-2" data-testid="booking-list">
          {b.loading && <span className="s">Loading…</span>}
          {!b.loading && rows.length === 0 && <span className="s" data-testid="no-results">Nothing matches.</span>}
          {rows.map((r) => {
            const pitch = r.kind === "contact" || r.kind === "festival" ? undefined : activeFor(b.pitches, r.kind, r.id);
            if (r.kind === "venue") {
              const venue = b.venues.find((v) => v.id === r.id);
              const isExpanded = expandedVenue === r.id;
              const venuePitchCount = b.pitches.filter((p) => p.target.kind === "venue" && p.target.id === r.id).length;
              return (
                <div key={r.key} className="card" data-testid={`row-venue-${r.id}`}>
                  <Flagged kind="venue" id={r.id} pitches={b.pitches}>{(flag, flagForm) => (<>
                    <div className="flex items-center justify-between gap-2">
                      <button type="button" className="grid min-w-0 flex-1 gap-0.5 text-left" onClick={() => setExpandedVenue(isExpanded ? null : r.id)} data-testid={`venue-expand-${r.id}`}>
                        <b className="truncate">{r.title}</b><span className="s truncate">{r.sub}</span>
                      </button>
                      {pitch && <StatusChip status={pitch.status} />}
                      {flag}
                    </div>
                    {flagForm}
                  </>)}</Flagged>
                  {isExpanded && venue && (
                    <div className="mt-2 grid gap-1 border-t border-line pt-2" data-testid={`venue-details-${r.id}`}>
                      {venue.capacity && <span className="s">Capacity: {venue.capacity}</span>}
                      {(venue.address.city || venue.address.state) && <span className="s">{[venue.address.city, venue.address.state].filter(Boolean).join(", ")}</span>}
                      {venue.website && <a href={venue.website} target="_blank" rel="noopener noreferrer" className="s font-semibold" onClick={(e) => e.stopPropagation()}>{venue.website}</a>}
                      {venuePitchCount > 0 && <span className="s">{venuePitchCount} pitch{venuePitchCount === 1 ? "" : "es"}</span>}
                      <Link href={hrefFor("venue", r.id)} className="s font-semibold" data-testid={`venue-full-${r.id}`}>View full record →</Link>
                    </div>
                  )}
                </div>
              );
            }
            return (
              <div key={r.key} className={`card ${r.kind === "edition" ? "ml-4" : ""}`} data-testid={`row-${r.kind}-${r.id}`}>
                <FlaggedRow kind={r.kind} id={r.id} pitches={b.pitches}>{(flag, flagForm) => (<>
                  <div className="flex items-center justify-between gap-2">
                    <Link href={hrefFor(r.kind, r.id)} className="grid min-w-0 flex-1 gap-0.5">
                      <b className="truncate">{r.title}</b><span className="s truncate">{r.sub}</span>
                    </Link>
                    {pitch && <StatusChip status={pitch.status} />}
                    {flag}
                  </div>
                  {flagForm}
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

/** Promoter and edition rows have a flag; festivals and contacts don't. */
function FlaggedRow({ kind, id, pitches, children }: { kind: string; id: string; pitches: PitchRow[]; children(button: React.ReactNode, form: React.ReactNode): React.ReactNode }) {
  if (kind !== "promoter" && kind !== "edition") return <>{children(null, null)}</>;
  return <Flagged kind={kind} id={id} pitches={pitches}>{children}</Flagged>;
}

function PitchList({ pitches, userName }: { pitches: PitchRow[]; userName(id?: string): string | undefined }) {
  const today = todayStr();
  return (
    <div className="grid gap-3" data-testid="pitch-list">
      {pitches.length === 0 && <span className="s">Nothing on the Pitch List. Tap a flag to add something.</span>}
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
