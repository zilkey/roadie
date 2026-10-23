"use client";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection } from "@/lib/firestore-hooks";
import { useProfile } from "@/lib/auth";
import type { McpToken, User } from "@/schema";

export default function AiKeysPage() { return <AdminOnly><AiKeys /></AdminOnly>; }

const when = (t: unknown) => (t && typeof (t as { toDate?: unknown }).toDate === "function" ? (t as { toDate(): Date }).toDate().toLocaleString("en-US", { timeZone: BAND_TIME_ZONE }) : "never");

function AiKeys() {
  const me = useProfile();
  const tokens = useCollection<McpToken>("mcpTokens");
  const users = useCollection<User>("users");
  const { call, error, busy } = useCommand();
  const [label, setLabel] = useState("");
  const [userId, setUserId] = useState("");
  const [fresh, setFresh] = useState<{ token: string; label: string } | null>(null);
  const eligible = (users.rows ?? []).filter((u) => u.mcpAccess);
  const mine = users.rows?.find((u) => u.id === me.uid);
  const name = (id: string) => users.rows?.find((x) => x.id === id)?.name ?? id;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const r = await call<{ token: string; label: string }>("mcpTokens.create", { label, ...(userId ? { userId } : {}) });
    if (r) { setFresh({ token: r.token, label: r.label }); setLabel(""); }
  }
  const rows = [...(tokens.rows ?? [])].sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt) || a.label.localeCompare(b.label));

  return (
    <div className="grid gap-4">
      <PageTitle title="AI keys" sub="Let Claude (or another AI) read and update the band's data. Drafts only: it can never send email." />
      <ErrorBox error={error} />
      {mine && !mine.mcpAccess && eligible.length === 0 && (
        <div className="card" data-testid="no-access"><span className="s">Turn on AI access for yourself on the Users page first.</span></div>
      )}
      {fresh && (
        <div className="card hi" data-testid="new-key">
          <b>Copy this key now: it will not be shown again.</b>
          <code className="break-all rounded bg-soft p-2" data-testid="new-key-value">{fresh.token}</code>
          <span className="s">Label: {fresh.label}. See docs/MCP.md for how to connect Claude Code.</span>
          <div><button className="btn ghost sm" onClick={() => setFresh(null)} data-testid="key-done">Done, I copied it</button></div>
        </div>
      )}
      <form onSubmit={create} className="card" data-testid="create-key">
        <span className="lbl">New key</span>
        <input className="input" placeholder="Label, e.g. Jeff · Claude Code" required value={label} onChange={(e) => setLabel(e.target.value)} data-testid="key-label" />
        <select className="select" value={userId} onChange={(e) => setUserId(e.target.value)} data-testid="key-user" aria-label="For">
          <option value="">For me</option>
          {eligible.filter((u) => u.id !== me.uid).map((u) => <option key={u.id} value={u.id}>For {u.name}</option>)}
        </select>
        <button className="btn acc" disabled={busy} data-testid="key-create">Create key</button>
      </form>
      <div className="grid gap-2" data-testid="key-list">
        {rows.length === 0 && <span className="s">No keys yet.</span>}
        {rows.map((t) => (
          <div key={t.id} className="card" data-testid={`key-${t.label}`}>
            <div className="flex items-center justify-between gap-2">
              <div><b>{t.label}</b> {t.revokedAt ? <span className="chip">revoked</span> : <span className="chip g">active</span>}</div>
              {!t.revokedAt && <button className="btn ghost sm" disabled={busy} onClick={() => confirm(`Revoke "${t.label}"?`) && call("mcpTokens.revoke", { id: t.id })} data-testid="key-revoke">Revoke</button>}
            </div>
            <span className="s">{name(t.userId)} · last used {when(t.lastUsedAt)}{t.revokedAt ? ` · revoked ${when(t.revokedAt)}` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
