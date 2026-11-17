"use client";
import { useCallback, useEffect, useState } from "react";
import { runCommand } from "@/lib/commands";
import { useAct } from "./shared";

interface Invite { id: string; name: string; email: string; role: string }

/**
 * People invited to this artist who already belong to another one: they join only when they accept, on their next sign-in
 * (tenancy plan Q2-A). Until then this artist sees just the name and email it typed. Hidden when there are none.
 */
export function PendingInvites({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<Invite[]>([]);
  const { act, busy, error } = useAct();
  const load = useCallback(() => {
    runCommand<{ invites: Invite[] }>("invites.pending", {}).then((r) => setRows(r.invites), () => setRows([]));
  }, []);
  useEffect(load, [load, refreshKey]);
  if (!rows.length) return null;
  return (
    <div className="card grid gap-2" data-testid="pending-invites">
      <h2 className="text-base">Waiting to join</h2>
      <p className="s m-0">They&apos;re already in another band on Roadie, so they join this one when they say yes, the next time they sign in.</p>
      {error && <div className="err" role="alert">{error}</div>}
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2" data-testid={`invite-${r.email}`}>
          <span className="grid"><b>{r.name}</b><span className="s">{r.email} · {r.role === "admin" ? "Admin" : "Standard"}</span></span>
          <button type="button" className="btn ghost sm" disabled={busy} data-testid="invite-withdraw"
            onClick={async () => { if (await act("invites.withdraw", { id: r.id })) load(); }}>Withdraw</button>
        </div>
      ))}
    </div>
  );
}
