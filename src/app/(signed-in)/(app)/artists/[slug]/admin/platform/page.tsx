"use client";
import { useCallback, useEffect, useState } from "react";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { usePlatformAdmin } from "@/lib/sharedEdit";

interface Req { uid: string; name: string; email: string; artistName: string | null; note: string | null; requestedAt: string | null }
interface Editor { uid: string; name: string; email: string; approvedAt: string | null }
interface Lists { requests: Req[]; editors: Editor[] }

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

/**
 * Admin › Platform: Roadie's own settings, for its platform admins only (platform/admins). Who may change the shared directory
 * (venues, acts, promoters, festivals): requests to edit with Approve and Deny, and approved editors with Revoke.
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
    </div>
  );
}
