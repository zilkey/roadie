"use client";
/**
 * Find sent emails: for every active pitch on a campaign page with no email in Roadie yet, look in the booking mailbox for
 * what was already sent (email.suggest), tick the threads that belong, and link them all at once (email.link). For pitches
 * pitched by hand, from Gmail, before the booking mailbox was set.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link, { useArtist } from "@/lib/artist";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle } from "@/components/ui";
import { Crumbs, campaignsCrumb } from "@/components/booking/BookingNav";
import { BackLink, useBooking, type PitchRow } from "@/components/booking/common";
import { useCollection } from "@/lib/firestore-hooks";
import { runCommand, type CommandError } from "@/lib/commands";
import { STATUS_LABEL, isActive, todayStr, type Status } from "@/lib/booking";
import { emailCells, type ThreadLike } from "@/lib/emailCells";
import { inCampaign, liveCampaigns, ONGOING } from "@/lib/campaigns";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import { ROUTES } from "@/lib/routes";
import type { EmailThread } from "@/schema";

interface Hit { threadId: string; subject: string; snippet: string; lastDate: string; participants: string[]; why: "contact" | "subject" | "text"; linkedId?: string; elsewhere?: string }
type Found = { hits: Hit[] } | { error: string };
const WHY: Record<Hit["why"], string> = { contact: "To a contact", subject: "Name in the subject", text: "Name in the email" };
const AT_ONCE = 3;

const short = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: BAND_TIME_ZONE });

export default function Page() {
  return <AdminOnly><Suspense fallback={null}><FindSent /></Suspense></AdminOnly>;
}

function FindSent() {
  const params = useSearchParams();
  const campaign = params.get("campaign") || ONGOING;
  const b = useBooking();
  const { artistId } = useArtist();
  const threads = useCollection<EmailThread>("emailThreads", { where: [["artistId", "==", artistId]] }).rows as ThreadLike[] | undefined;
  const live = useMemo(() => liveCampaigns(b.campaigns), [b.campaigns]);
  const camp = campaign !== ONGOING ? live.get(campaign) : undefined;
  const back = campaign === ONGOING ? { href: ROUTES.bookingPitches.path, label: ROUTES.bookingPitches.title } : { href: `/booking/campaigns/${campaign}`, label: camp?.name ?? "Campaign" };
  const placeOf = (p: PitchRow) => (p.target.kind === "edition" ? b.editions.find((e) => e.id === p.target.id)?.festivalId ?? p.target.id : p.target.id);

  // The pitches to look for, fixed once the data is in: linking one must not pull it off the page.
  const [pitches, setPitches] = useState<PitchRow[] | null>(null);
  useEffect(() => {
    if (pitches || b.loading || !threads) return;
    const today = todayStr();
    setPitches(b.pitches.filter((p) => isActive(p.status) && inCampaign(p, campaign, live) && emailCells(p, threads, placeOf(p), today).threads.length === 0)
      .sort((x, y) => x.target.name.localeCompare(y.target.name)));
  }, [b.loading, threads, b.pitches]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = <Crumbs fixed items={[campaignsCrumb, { label: back.label, href: back.href }, { label: "Find sent emails" }]} back={<BackLink href={back.href} label={back.label} />} />;
  if (!pitches) return <div className="show-page"><PageTitle back={title} title="Find sent emails" /></div>;
  return <Finder pitches={pitches} placeOf={placeOf} title={title} back={back.href} />;
}

function Finder({ pitches, placeOf, title, back }: { pitches: PitchRow[]; placeOf(p: PitchRow): string; title: React.ReactNode; back: string }) {
  const [found, setFound] = useState<Record<string, Found>>({});
  const [account, setAccount] = useState("");
  const [ticked, setTicked] = useState<Record<string, string[]>>({}); // pitch id → thread ids
  const [linked, setLinked] = useState<Record<string, string[]>>({}); // pitch id → thread ids linked here
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  // Look for each pitch, a few at a time, ticking the hits that are surely its own (to a contact, or its name in the subject).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const queue = [...pitches];
    const claimed = new Set<string>();
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        const id = p.id;
        try {
          const r = await runCommand<{ account: string; hits: Hit[] }>("email.suggest", { pitchId: id });
          setAccount(r.account);
          setFound((f) => ({ ...f, [id]: { hits: r.hits } }));
          const best = r.hits.find((h) => h.why !== "text" && !h.elsewhere && !h.linkedId && !claimed.has(h.threadId));
          if (best) { claimed.add(best.threadId); setTicked((t) => ({ ...t, [id]: [best.threadId] })); }
        } catch (e) {
          setFound((f) => ({ ...f, [id]: { error: (e as CommandError).message } }));
        }
      }
    };
    void Promise.all(Array.from({ length: AT_ONCE }, worker));
  }, [pitches]);

  const pitchById = useMemo(() => new Map(pitches.map((p) => [p.id, p])), [pitches]);
  /** A thread lives on one place: ticking it for a pitch of another place unticks it there. Pitches of the same place share it. */
  function toggle(pitchId: string, threadId: string) {
    setTicked((t) => {
      const on = (t[pitchId] ?? []).includes(threadId);
      if (on) return { ...t, [pitchId]: t[pitchId].filter((x) => x !== threadId) };
      const place = placeOf(pitchById.get(pitchId)!);
      const next = Object.fromEntries(Object.entries(t).map(([pid, ids]) => [pid, placeOf(pitchById.get(pid)!) === place ? ids : ids.filter((x) => x !== threadId)]));
      return { ...next, [pitchId]: [...(next[pitchId] ?? []), threadId] };
    });
  }

  const todo = Object.entries(ticked).flatMap(([pid, ids]) => ids.filter((t) => !(linked[pid] ?? []).includes(t)).map((t) => ({ pid, t })));
  async function linkAll() {
    setLinking(true); setError(null);
    const byThread = new Map<string, string[]>();
    for (const { pid, t } of todo) byThread.set(t, [...(byThread.get(t) ?? []), pid]);
    for (const [threadId, pids] of byThread) {
      const first = pitchById.get(pids[0])!;
      try {
        await runCommand("email.link", { threadId, target: { kind: first.target.kind, id: first.target.id }, pitchId: pids[0], ...(pids.length > 1 ? { pitchIds: pids } : {}) });
        setLinked((l) => Object.fromEntries([...Object.entries(l), ...pids.map((pid) => [pid, [...(l[pid] ?? []), threadId]])]));
      } catch (e) {
        setError(`${first.target.name}: ${(e as CommandError).message}`);
        break;
      }
    }
    setLinking(false);
  }

  const done = Object.keys(found).length;
  const withHits = pitches.filter((p) => { const f = found[p.id]; return f && "hits" in f && f.hits.length > 0; }).length;
  const linkedCount = Object.values(linked).reduce((n, ids) => n + ids.length, 0);
  const sub = `${account ? `Looks in ${account}'s sent mail` : "Looks in the booking mailbox's sent mail"} for the ${pitches.length} active ${pitches.length === 1 ? "pitch" : "pitches"} with no email in Roadie. Nothing is copied until you link it.`;

  return (
    <div className="show-page" data-testid="find-sent-page">
      <PageTitle back={title} title="Find sent emails" sub={sub} />
      {pitches.length === 0
        ? <div className="empty" data-testid="find-sent-nothing"><span>Every active pitch here has its email in Roadie. <Link href={back} className="underline">Back</Link></span></div>
        : <section className="card grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="s flex-1" data-testid="find-sent-progress">
                {done < pitches.length ? `Looked at ${done} of ${pitches.length}…` : `Found emails for ${withHits} of ${pitches.length}.`}
                {linkedCount > 0 && ` Linked ${linkedCount}.`}
              </span>
              <button type="button" className="btn acc" disabled={linking || todo.length === 0} onClick={() => void linkAll()} data-testid="find-sent-link">
                {todo.length ? `Link ${todo.length} ${todo.length === 1 ? "email" : "emails"}` : "Link emails"}
              </button>
            </div>
            <ErrorBox error={error} />
            <div className="grid gap-2">
              {pitches.map((p) => <PitchFinds key={p.id} p={p} found={found[p.id]} ticked={ticked[p.id] ?? []} linked={linked[p.id] ?? []} disabled={linking} onToggle={(t) => toggle(p.id, t)} />)}
            </div>
            <p className="s">Linking puts the thread on the place&apos;s Email card and the pitch&apos;s email columns, adds the replies to the pitch&apos;s timeline, and watches it for new ones.</p>
          </section>}
    </div>
  );
}

function PitchFinds({ p, found, ticked, linked, disabled, onToggle }: { p: PitchRow; found?: Found; ticked: string[]; linked: string[]; disabled: boolean; onToggle(threadId: string): void }) {
  const search = `/booking/email/search?target=${p.target.kind}:${p.target.id}&pitch=${p.id}`;
  return (
    <div className="grid gap-1.5 rounded-xl border p-3" style={{ borderColor: "var(--line)" }} data-testid={`find-pitch-${p.id}`}>
      <span className="flex flex-wrap items-center gap-2">
        <Link href={`/booking/pitches/${p.id}`} className="font-semibold">{p.target.name}</Link>
        <span className="chip">{STATUS_LABEL[p.status as Status]}</span>
        <span className="flex-1" />
        <Link href={search} className="btn sm" data-testid={`find-search-${p.id}`}>Search Gmail</Link>
      </span>
      {!found && <span className="s">Looking…</span>}
      {found && "error" in found && <div className="err" role="alert">{found.error}</div>}
      {found && "hits" in found && found.hits.length === 0 && <span className="s" data-testid={`find-none-${p.id}`}>Nothing sent that names it. Try Search Gmail.</span>}
      {found && "hits" in found && found.hits.map((h) => {
        const isLinked = linked.includes(h.threadId);
        return (
          <label key={h.threadId} className="flex items-start gap-3 rounded-lg p-2" style={{ background: "var(--bg2, transparent)" }} data-testid={`find-hit-${p.id}-${h.threadId}`}>
            <input type="checkbox" className="mt-1" checked={isLinked || ticked.includes(h.threadId)} disabled={disabled || isLinked} onChange={() => onToggle(h.threadId)} data-testid={`find-tick-${p.id}-${h.threadId}`} />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <b className="truncate">{h.subject || "(no subject)"}</b>
                <span className="chip">{WHY[h.why]}</span>
                {h.elsewhere && <span className="chip" data-testid={`find-elsewhere-${p.id}-${h.threadId}`}>On {h.elsewhere}</span>}
                {isLinked && <span className="chip g" data-testid={`find-linked-${p.id}-${h.threadId}`}>Linked</span>}
              </span>
              <span className="s truncate">To {h.participants.join(", ") || "—"}</span>
              <span className="line-clamp-2 text-sm">{h.snippet}</span>
            </span>
            <span className="s shrink-0">{short(h.lastDate)}</span>
          </label>
        );
      })}
    </div>
  );
}
