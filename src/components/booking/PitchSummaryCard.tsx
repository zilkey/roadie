"use client";
import Link, { useArtist } from "@/lib/artist";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import { useCollection } from "@/lib/firestore-hooks";
import { Flagged, FlagIcon, PitchDates, StatusPill, type PitchRow } from "@/components/booking/common";
import { fmtDate, isActive, todayStr } from "@/lib/booking";
import { ms, pastPitches, pitchOutcome, pitchWhen } from "@/lib/pitchSummary";
import type { Edition, User } from "@/schema";

const monDay = (t?: unknown) => (ms(t) ? new Date(ms(t)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BAND_TIME_ZONE }) : "");
const monYear = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: BAND_TIME_ZONE });

const ACTIVE_BORDER = "color-mix(in srgb, var(--accent) 45%, var(--border))";

function Head({ active, status, children }: { active: boolean; status?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex" style={{ color: active ? "var(--pitched)" : "var(--muted)" }}><FlagIcon filled={active} /></span>
      <b className="text-[1rem]">{children}</b>
      {status && <StatusPill status={status} />}
    </div>
  );
}

/** The active pitch: configuration, date chips, and last contact / next step / who's handling it. */
function ActiveRow({ p, label }: { p: PitchRow; label?: string }) {
  const { doc: artist } = useArtist();
  const users = useCollection<User>("users").rows ?? [];
  const config = artist?.configurations.find((c) => c.id === p.pitchedAs)?.name ?? "Not sure yet";
  const assignee = users.find((u) => u.id === p.assigneeId)?.name.split(" ")[0];
  const line = [
    monDay(p.lastContactAt) && `Last contact ${monDay(p.lastContactAt)}`,
    p.nextStep?.text && `Next step: ${p.nextStep.text}${p.nextStep.due ? ` by ${fmtDate(p.nextStep.due)}` : ""}`,
    assignee && `${assignee}'s handling it`,
  ].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3" data-testid={`pitch-summary-${p.id}`}>
      <div className="grid min-w-0 gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {label && <b>{label}</b>}
          {label && <StatusPill status={p.status} />}
          <b className="text-[1rem]" data-testid="pitch-config">{config}</b>
          <PitchDates dates={p.dates} today={todayStr()} testid="pitch-dates-summary" empty="No dates yet" />
        </div>
        {line && <span className="d-muted text-[0.875rem]" data-testid="pitch-summary-line">{line}</span>}
      </div>
      <Link href={`/booking/pitches/${p.id}`} className="btn acc" data-testid={label ? `view-pitch-${p.id}` : "view-pitch"}>View pitch</Link>
    </div>
  );
}

/** "Pitched before: Duo, Mar 2026 · Became a show · see it", the most recent, then "and N more". Nothing when there are none. */
function PastLine({ past }: { past: PitchRow[] }) {
  const { doc: artist } = useArtist();
  if (!past.length) return null;
  const name = (p: PitchRow) => artist?.configurations.find((c) => c.id === p.pitchedAs)?.name ?? "Not sure yet";
  const when = (p: PitchRow) => (pitchWhen(p) ? `, ${monYear(pitchWhen(p))}` : "");
  const [first, ...more] = past;
  return (
    <>
      <div className="d-sep" />
      <p className="d-muted m-0 text-[0.875rem]" data-testid="past-pitches">
        Pitched before: {name(first)}{when(first)} · {pitchOutcome(first)} · <Link href={`/booking/pitches/${first.id}`} className="underline" data-testid={`pitch-link-${first.id}`}>see it</Link>
        {more.length > 0 && <> and {more.length} more: {more.map((p, i) => (
          <span key={p.id}>{i > 0 && ", "}<Link href={`/booking/pitches/${p.id}`} className="underline" data-testid={`pitch-link-${p.id}`}>{name(p)}{when(p)}</Link></span>
        ))}</>}
      </p>
    </>
  );
}

/**
 * The small card at the top of a venue, promoter or festival-year page (private to the band): "On the Pitch List" with the pitch's
 * status, configuration, dates and next step and a View pitch button, or "Not on the Pitch List" with Add to Pitch List. Editing happens on the pitch page.
 * `mine` is this band's pitches for the target (any status).
 */
export function PitchSummaryCard({ kind, id, mine, testid = "pitch-summary" }: { kind: "venue" | "promoter" | "edition"; id: string; mine: PitchRow[]; testid?: string }) {
  const active = mine.find((p) => isActive(p.status));
  const past = pastPitches(mine);
  if (active) {
    return (
      <section className="d-card" style={{ borderColor: ACTIVE_BORDER }} aria-label="Pitch" data-testid={testid} data-active="1">
        <Head active status={active.status}>On the Pitch List</Head>
        <ActiveRow p={active} />
        <PastLine past={past} />
      </section>
    );
  }
  return (
    <section className="d-card" aria-label="Pitch" data-testid={testid} data-active="0">
      <Flagged kind={kind} id={id} pitches={mine} label="Add to Pitch List">{(flag, form) => (<>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span data-testid="not-on-pitch-list"><Head active={false}>Not on the Pitch List</Head></span>
          {flag}
        </div>
        {form}
      </>)}</Flagged>
      <PastLine past={past} />
    </section>
  );
}

/**
 * The festival version: one row per year with an active pitch, or (none active) the upcoming year's Add to Pitch List.
 * `mine` is this band's pitches across the festival's years.
 */
export function FestivalPitchCard({ editions, mine, upcoming }: { editions: (Edition & { id: string })[]; mine: PitchRow[]; upcoming?: Edition & { id: string } }) {
  const actives = mine.filter((p) => isActive(p.status));
  const past = pastPitches(mine);
  const label = (p: PitchRow) => editions.find((e) => e.id === p.target.id)?.label ?? p.target.name;
  if (actives.length) {
    return (
      <section className="d-card" style={{ borderColor: ACTIVE_BORDER }} aria-label="Pitch" data-testid="festival-pitch" data-active="1">
        <Head active status={actives.length === 1 ? actives[0].status : undefined}>On the Pitch List</Head>
        {actives.map((p) => <ActiveRow key={p.id} p={p} label={actives.length > 1 ? label(p) : undefined} />)}
        <PastLine past={past} />
      </section>
    );
  }
  return (
    <section className="d-card" aria-label="Pitch" data-testid="festival-pitch" data-active="0">
      {!upcoming ? (
        <Head active={false}><span data-testid="not-on-pitch-list">{editions.length === 0 ? "Not on the Pitch List. Add a year first." : "Not on the Pitch List"}</span></Head>
      ) : (
        <Flagged kind="edition" id={upcoming.id} pitches={mine} label={`Add ${upcoming.label} to the Pitch List`}>{(flag, form) => (<>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span data-testid="not-on-pitch-list"><Head active={false}>Not on the Pitch List</Head></span>
            {flag}
          </div>
          {form}
        </>)}</Flagged>
      )}
      <PastLine past={past} />
    </section>
  );
}
