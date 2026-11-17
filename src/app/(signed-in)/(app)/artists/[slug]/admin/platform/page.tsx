"use client";
import { useCallback, useEffect, useState } from "react";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { usePlatformAdmin } from "@/lib/sharedEdit";
import { useArtist } from "@/lib/artist";

interface Req { uid: string; name: string; email: string; artistName: string | null; note: string | null; requestedAt: string | null }
interface Editor { uid: string; name: string; email: string; approvedAt: string | null }
interface Lists { requests: Req[]; editors: Editor[] }
/** One row of platform.artists (src/server/commands/platform.ts). */
interface PlatformArtistRow {
  id: string; name: string; slug: string; timeZone: string; createdAt: string | null;
  creator: { uid: string; name: string; email: string } | null;
  usageDate: string; usage: Record<string, number>; exempt: boolean; suspendedAt: string | null;
}
interface ArtistList { limits: Record<string, number>; newArtistsToday: number; newArtistsPerDay: number; artists: PlatformArtistRow[] }

const METER_LABEL: Record<string, string> = { roadieMessages: "Roadie", webLookups: "web", transcriptions: "voice", maps: "maps", publicMaps: "fan-page maps" };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

/**
 * Admin › Platform: Roadie's own settings, for its platform admins only (platform/admins). Who may change the shared directory
 * (venues, acts, promoters, festivals): requests to edit with Approve and Deny, and approved editors with Revoke. Below, every
 * artist on Roadie, newest first (platform.artists), with Suspend and Unsuspend (platform.suspend).
 */
export default function PlatformPage() {
  const platformAdmin = usePlatformAdmin();
  if (!platformAdmin) return <div className="card" data-testid="platform-denied">Only Roadie&apos;s platform admins see this page.</div>;
  return <PlatformBody />;
}

function PlatformBody() {
  const { call, error, busy } = useCommand();
  const [lists, setLists] = useState<Lists | null>(null);
  const load = useCallback(async () => { const r = await call<Lists>("sharedEditors.list", {}); if (r) setLists(r); }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (name: string, uid: string) => { if (await call(name, { uid })) await load(); };

  return (
    <div className="grid gap-5" data-testid="platform-page">
      <PageTitle title="Platform" sub="Roadie's own settings. Only platform admins see this page." />
      <ErrorBox error={error} />
      <section className="card" data-testid="platform-requests" aria-labelledby="platform-requests-title">
        <h2 id="platform-requests-title" className="text-lg font-bold">Asked to edit shared records</h2>
        <p className="s">Approved editors can change the venues, acts, promoters and festivals every band shares.</p>
        {!lists ? <span className="s">Loading…</span> : lists.requests.length === 0 ? <div className="empty">No one is waiting.</div> : (
          <div className="grid">
            {lists.requests.map((r) => (
              <div key={r.uid} className="d-row" data-testid={`platform-request-${r.uid}`}>
                <div className="grid min-w-0 gap-0.5">
                  <b>{r.name || r.email}</b>
                  <span className="s">{[r.email, r.artistName, day(r.requestedAt)].filter(Boolean).join(" · ")}</span>
                  {r.note && <span className="s">“{r.note}”</span>}
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn acc sm" disabled={busy} data-testid={`platform-approve-${r.uid}`} onClick={() => void act("sharedEditors.approve", r.uid)}>Approve</button>
                  <button type="button" className="btn ghost sm" disabled={busy} data-testid={`platform-deny-${r.uid}`} onClick={() => void act("sharedEditors.deny", r.uid)}>Deny</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="card" data-testid="platform-editors" aria-labelledby="platform-editors-title">
        <h2 id="platform-editors-title" className="text-lg font-bold">Approved editors{lists ? ` (${lists.editors.length})` : ""}</h2>
        {!lists ? <span className="s">Loading…</span> : lists.editors.length === 0 ? <div className="empty">No one yet.</div> : (
          <div className="grid">
            {lists.editors.map((e) => (
              <div key={e.uid} className="d-row" data-testid={`platform-editor-${e.uid}`}>
                <div className="grid min-w-0 gap-0.5"><b>{e.name}</b><span className="s">{[e.email, e.approvedAt && `approved ${day(e.approvedAt)}`].filter(Boolean).join(" · ")}</span></div>
                <button type="button" className="btn ghost sm" disabled={busy} data-testid={`platform-revoke-${e.uid}`}
                  onClick={() => { if (confirm(`Take away ${e.name}'s approval to edit shared records?`)) void act("sharedEditors.revoke", e.uid); }}>Revoke</button>
              </div>
            ))}
          </div>
        )}
      </section>
      <NewArtists />
    </div>
  );
}

function NewArtists() {
  const { call, error, busy } = useCommand();
  const here = useArtist().artistId;
  const [list, setList] = useState<ArtistList | null>(null);
  const load = useCallback(async () => { const r = await call<ArtistList>("platform.artists", {}); if (r) setList(r); }, []);
  useEffect(() => { void load(); }, [load]);
  const suspend = async (a: PlatformArtistRow, suspended: boolean) => {
    if (suspended && !confirm(`Suspend ${a.name}? Its members lose it, and its fan page and Roadie stop working, until you unsuspend it.`)) return;
    if (await call("platform.suspend", { artistId: a.id, suspended })) await load();
  };
  return (
    <section className="card" data-testid="platform-artists" aria-labelledby="platform-artists-title">
      <h2 id="platform-artists-title" className="text-lg font-bold">New artists{list ? ` (${list.artists.length})` : ""}</h2>
      {list && <p className="s">{list.newArtistsToday} of {list.newArtistsPerDay} new artists today (UTC). Usage is today in each artist&apos;s own time zone.</p>}
      <ErrorBox error={error} />
      {!list ? <span className="s">Loading…</span> : list.artists.length === 0 ? <div className="empty">No artists yet.</div> : (
        <div className="grid">
          {list.artists.map((a) => {
            const used = Object.entries(a.usage).filter(([, n]) => n > 0);
            return (
              <div key={a.id} className="d-row" data-testid={`platform-artist-${a.id}`}>
                <div className="grid min-w-0 gap-0.5">
                  <b>
                    {a.name}
                    {a.exempt && <span className="pill ml-2" data-testid={`platform-artist-exempt-${a.id}`}>Exempt</span>}
                    {a.suspendedAt && <span className="pill ml-2" data-testid={`platform-artist-suspended-${a.id}`}>Suspended {day(a.suspendedAt)}</span>}
                  </b>
                  <span className="s">{[when(a.createdAt), a.creator && (a.creator.name ? `by ${a.creator.name}${a.creator.email ? ` (${a.creator.email})` : ""}` : `by ${a.creator.email || a.creator.uid}`), a.timeZone].filter(Boolean).join(" · ")}</span>
                  <span className="s" data-testid={`platform-artist-usage-${a.id}`}>
                    Today: {used.length === 0 ? "nothing used" : used.map(([m, n]) => `${METER_LABEL[m] ?? m} ${n}/${a.exempt ? "∞" : list.limits[m]}`).join(", ")}
                  </span>
                </div>
                {a.suspendedAt
                  ? <button type="button" className="btn ghost sm" disabled={busy} data-testid={`platform-unsuspend-${a.id}`} onClick={() => void suspend(a, false)}>Unsuspend</button>
                  : <button type="button" className="btn ghost sm" disabled={busy || a.id === here} title={a.id === here ? "You're working in this artist" : undefined} data-testid={`platform-suspend-${a.id}`} onClick={() => void suspend(a, true)}>Suspend</button>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
