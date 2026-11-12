"use client";
import { useMemo, useState } from "react";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { AdminOnly } from "@/components/Guard";
import { Dialog, ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { DialogClose } from "@/components/booking/AddContactDialog";
import { Crumbs } from "@/components/booking/BookingNav";
import { StatusChip, useBooking, type PitchRow } from "@/components/booking/common";
import { followUpFor, STATUS_LABEL, todayStr } from "@/lib/booking";
import { homeOf, liveCampaigns, ONGOING, sortCampaigns, statusCounts } from "@/lib/campaigns";
import { fmtInstant } from "@/lib/timezone";
import { ROUTES } from "@/lib/routes";

/**
 * All campaigns (#82): Ongoing and every active campaign with how its pitches stand, then the closed ones with how they went.
 * "New campaign" (only here) asks for a name and opens the new, empty campaign.
 */
export function CampaignsIndex() { return <AdminOnly><Campaigns /></AdminOnly>; }

const Dash = () => <span className="dash">—</span>;

function Campaigns() {
  const b = useBooking();
  const [adding, setAdding] = useState(false);
  const live = useMemo(() => liveCampaigns(b.campaigns), [b.campaigns]);
  const { active, closed } = useMemo(() => sortCampaigns(live.values()), [live]);
  // Each pitch counts once, toward its home: its campaign while that is active, else Ongoing. A closed campaign lists its history.
  const home = useMemo(() => {
    const by = new Map<string, PitchRow[]>();
    for (const p of b.pitches) { const k = homeOf(p, live); by.set(k, [...(by.get(k) ?? []), p]); }
    return by;
  }, [b.pitches, live]);
  const history = (id: string) => b.pitches.filter((p) => p.campaignId === id);
  const today = todayStr();
  const due = (ps: PitchRow[]) => ps.filter((p) => followUpFor(p, today)).length;
  const last = (ps: PitchRow[]) => Math.max(0, ...ps.map((p) => p.lastContactAt?.toMillis() ?? 0));
  const day = (ms: number) => (ms ? fmtInstant(ms, { month: "short", day: "numeric" }) : <Dash />);
  const roll = (ps: PitchRow[]) => {
    const c = statusCounts(ps);
    return c.length ? <span className="flex flex-wrap gap-1">{c.map(({ status, n }) => <StatusChip key={status} status={status} label={`${n} ${STATUS_LABEL[status]}`} />)}</span> : <Dash />;
  };
  const rows = [{ id: ONGOING, name: ROUTES.bookingPitches.title, sub: "Pitches not in another campaign", href: ROUTES.bookingPitches.path },
    ...active.map((c) => ({ id: c.id, name: c.name, sub: c.createdAt ? `Started ${fmtInstant((c.createdAt as { toMillis(): number }).toMillis(), { month: "short", day: "numeric" })}` : "", href: `/booking/campaigns/${c.id}` }))];

  return (
    <div className="grid gap-5" data-testid="campaigns-page">
      <PageTitle back={<Crumbs items={[{ label: ROUTES.bookingCampaigns.title }]} />} title={ROUTES.bookingCampaigns.title}
        sub={b.loading ? undefined : `${b.pitches.length} ${b.pitches.length === 1 ? "pitch" : "pitches"} in ${active.length + 1} ${active.length ? "campaigns" : "campaign"}. Every pitch is in exactly one.`}
        actions={<button type="button" className="btn acc" onClick={() => setAdding(true)} data-testid="campaign-new">+ New campaign</button>} />
      {b.loading ? <span className="s">Loading…</span> : <>
        <div className="book-tw">
          <table className="book-table" data-testid="campaigns-active">
            <thead><tr><th>Campaign</th><th>Pitches</th><th>Where they stand</th><th>Follow-ups due</th><th>Last contact</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const ps = home.get(r.id) ?? [];
                const n = due(ps);
                return (
                  <tr key={r.id} data-testid={`campaign-row-${r.id}`}>
                    <td className="name"><Link href={r.href} className="nm" data-testid={`campaign-link-${r.id}`}>{r.name}</Link>{r.sub && <span className="sub">{r.sub}</span>}</td>
                    <td data-testid={`campaign-total-${r.id}`}>{ps.length}</td>
                    <td>{roll(ps)}</td>
                    <td>{n ? <span className="chip y" data-testid={`campaign-due-${r.id}`}>{n} due</span> : <Dash />}</td>
                    <td className="nw">{day(last(ps))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {closed.length > 0 && <>
          <h2 className="s font-bold uppercase tracking-wide" data-testid="campaigns-closed-head">Closed</h2>
          <div className="book-tw">
            <table className="book-table" data-testid="campaigns-closed">
              <thead><tr><th>Campaign</th><th>Pitches</th><th>How it went</th><th>Closed</th></tr></thead>
              <tbody>
                {closed.map((c) => {
                  const ps = history(c.id);
                  return (
                    <tr key={c.id} data-testid={`campaign-row-${c.id}`}>
                      <td className="name"><Link href={`/booking/campaigns/${c.id}`} className="nm" data-testid={`campaign-link-${c.id}`}>{c.name}</Link></td>
                      <td>{ps.length}</td>
                      <td>{roll(ps)}</td>
                      <td className="nw">{day((c.updatedAt as { toMillis?(): number } | undefined)?.toMillis?.() ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>}
        <p className="s" data-testid="table-caption">A pitch is in one campaign. Closing a campaign keeps its pitches in it; the active ones show under Ongoing until you reopen it.</p>
      </>}
      <NewCampaignDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

/** New campaign: a name only, then the new campaign's page (empty, with "Add pitches from"). */
export function NewCampaignDialog({ open, onClose, onCreated }: { open: boolean; onClose(): void; /** Instead of opening the campaign's page. */ onCreated?(id: string, name: string): void }) {
  const router = useRouter();
  const { call, error, busy } = useCommand();
  const [name, setName] = useState("");
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const r = await call<{ id: string }>("campaigns.create", { name: n });
    if (!r) return;
    setName("");
    onClose();
    if (onCreated) onCreated(r.id, n); else router.push(`/booking/campaigns/${r.id}`);
  }
  return (
    <Dialog open={open} onClose={onClose} title="New campaign" testid="campaign-new-dialog">
      <DialogClose onClose={onClose} testid="campaign-new-close" />
      <form className="grid gap-3" onSubmit={(e) => void create(e)}>
        <label className="grid gap-1"><span className="s font-semibold">Name</span>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Breweries · Spring 2027" data-testid="campaign-new-name" /></label>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn acc" disabled={busy || !name.trim()} data-testid="campaign-new-create">Create campaign</button>
        </div>
      </form>
    </Dialog>
  );
}
