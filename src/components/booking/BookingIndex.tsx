"use client";
import { draftPath } from "@/schema/drafts";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useMemo, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection } from "@/lib/firestore-hooks";
import { useHasDraft } from "@/lib/drafts";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";
import {
  EntityForm, Tabs, StatusChip, contactForm, type SubmitMeta, festivalForm, hrefFor, promoterForm, useBooking, venueForm,
} from "@/components/booking/common";
import { PitchModal, type PitchTarget } from "@/components/booking/PitchModal";
import { fmtPhone, listRows, type ListRow, type Ref } from "@/components/booking/listRows";
import { appsOpenThisMonth, buildSearchItems, fmtDate, fmtPitchDate, isActive, searchItems, sortedDates } from "@/lib/booking";
import type { Show } from "@/schema";

/** The booking index. Each tab has its own route (/booking, /booking/pitches, /booking/venues, …) so it can be linked to. */
export function BookingIndex({ seg }: { seg: Seg }) { return <AdminOnly><Booking seg={seg} /></AdminOnly>; }

export type Seg = "all" | "pitches" | "venues" | "festivals" | "promoters" | "contacts";
type Add = null | "venue" | "promoter" | "festival" | "contact";

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
    const searching = q.trim().length > 0;
    const hit = searching ? new Set(searchItems(buildSearchItems(b), q).map((i) => `${i.kind}:${i.id}`)) : null;
    return listRows(b, seg, ours, hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.venues, b.promoters, b.festivals, b.editions, b.contacts, b.pitches, ours, q, seg]);
  const [target, setTarget] = useState<PitchTarget | null>(null);
  const activeCount = b.pitches.filter((p) => isActive(p.status)).length;

  const open = appsOpenThisMonth(b.editions);

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
        options={[["all", "All"], ["pitches", <>Pitch List <span className="chip a ml-1" data-testid="pitch-count">{activeCount}</span></>], ["venues", "Venues"], ["festivals", "Festivals & series"], ["promoters", "Promoters"], ["contacts", "Contacts"]]} />
      <ErrorBox error={error} />

      {/* The table takes the width; "Applications open this month" is a fixed-width column on its right (on top on phones). */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="grid min-w-0 flex-1 gap-3" data-testid={seg === "pitches" ? "pitch-list" : "booking-list"}>
          {b.loading && <span className="s">Loading…</span>}
          {!b.loading && rows.length === 0 && (seg === "pitches" && !q.trim()
            ? <div className="empty"><span>Nothing on the Pitch List. Tap a flag to add something.</span></div>
            : <div className="empty" data-testid="no-results"><span>Nothing matches.</span></div>)}
          {rows.length > 0 && <div className="book-tw"><BookingTable seg={seg} rows={rows} onFlag={setTarget} /></div>}
        </div>
        {open.length > 0 && (
          <aside className="card hi order-first lg:order-none lg:w-[300px] lg:flex-none" data-testid="apps-open">
            <span className="text-xs font-bold uppercase tracking-wider text-[color:var(--acc-btn)]">Applications open this month</span>
            {open.map((e) => (
              <Link key={e.id} href={hrefFor("edition", e.id)} className="grid gap-0.5" data-testid={`apps-open-${e.id}`}>
                <b className="text-lg leading-snug">{e.festivalName} {e.label}</b>
                <span className="s">{[e.appOpens && `Opens ${fmtDate(e.appOpens.date)}`, e.appDeadline && `closes ${fmtDate(e.appDeadline.date)}`].filter(Boolean).join(" · ")}</span>
              </Link>
            ))}
          </aside>
        )}
      </div>
      <PitchModal target={target} onClose={() => setTarget(null)} />

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

const Dash = () => <span className="dash">—</span>;

const FlagIcon = ({ filled }: { filled: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 21V4" /><path d="M5 4h12l-2.5 4L17 12H5" />
  </svg>
);

function BookingTable({ seg, rows, onFlag }: { seg: Seg; rows: ListRow[]; onFlag(t: PitchTarget): void }) {
  const router = useRouter();
  const artist = useArtist();
  const configs = artist.doc?.configurations ?? [];
  const flagged = seg !== "contacts";
  const heads: string[] = seg === "venues" ? ["Name", "City", "Email", "Phone", "Pitch"]
    : seg === "festivals" ? ["Festival", "Edition", "City", "Email", "Phone", "Pitch"]
    : seg === "promoters" ? ["Promoter", "Name", "City", "Email", "Phone", "Pitch"]
    : seg === "contacts" ? ["Name", "Organization", "City", "Email", "Phone"]
    : ["Name", "Type", "City", "Email", "Phone", "Pitch"];
  const link = (r: Ref, testid?: string) => <Link href={hrefFor(r.kind, r.id)} className="nm" data-testid={testid}>{r.name}</Link>;
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
        {p && <><span className="pc">{configs.find((c) => c.id === p.pitchedAs)?.name ?? "Not sure yet"}</span>{" "}
          <span className="pd">{sortedDates(p.dates).map(fmtPitchDate).join(", ") || "No dates yet"}</span></>}
      </td>
    );
  };
  const status = (r: ListRow) => r.pitch && <> <StatusChip status={r.pitch.status} /></>;
  const reach = (r: ListRow) => (<>
    <td>{r.email ? <a className="em" href={`mailto:${r.email}`}>{r.email}</a> : <Dash />}</td>
    <td className="nw">{r.phone ? <a className="ph" href={`tel:${r.phone}`}>{fmtPhone(r.phone)}</a> : <Dash />}</td>
  </>);
  const city = (r: ListRow) => <td className="nw">{r.city || <Dash />}</td>;
  const nameCell = (r: ListRow) => (
    <td>
      {link(r.to, `${r.kind}-full-${r.id}`)}{status(r)}
      {r.promoters.length > 0 && <span className="sub">promoted by {r.promoters.map((p, i) => <span key={p.id}>{i > 0 && ", "}<Link href={hrefFor("promoter", p.id)}>{p.name}</Link></span>)}</span>}
    </td>
  );

  return (
    <table className="book-table">
      <thead><tr>
        {flagged && <th className="flag" aria-label="Pitch List flag" />}
        {heads.map((h) => <th key={h} className={h === "Pitch" ? "pitch" : undefined}>{h}</th>)}
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.kind}:${r.id}`} data-testid={`row-${r.kind}-${r.id}`}>
            {flagged && flag(r)}
            {seg === "festivals" ? (<>
              <td>{link(r.festival!, r.kind === "festival" ? `festival-full-${r.id}` : `festival-name-${r.id}`)}</td>
              <td>{r.edition ? <>{link(r.edition, `edition-full-${r.id}`)}{status(r)}</> : <Link href={`/booking/festivals/${r.id}?addEdition=1`} className="nm" data-testid={`add-edition-${r.id}`}>Add edition</Link>}</td>
            </>) : seg === "promoters" ? (<>
              <td>{link(r.to, `promoter-full-${r.id}`)}{status(r)}</td>
              <td>{r.person ?? <Dash />}</td>
            </>) : seg === "contacts" ? (<>
              <td>{link(r.to, `contact-full-${r.id}`)}</td>
              <td>{r.organization ? link(r.organization) : <Dash />}</td>
            </>) : (<>
              {nameCell(r)}
              {(seg === "all" || seg === "pitches") && <td className="nw">{r.type}</td>}
            </>)}
            {city(r)}
            {reach(r)}
            {seg !== "contacts" && pitchCell(r)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
