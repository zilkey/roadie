"use client";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection } from "@/lib/firestore-hooks";
import { useProfile } from "@/lib/auth";
import type { Musician, User } from "@/schema";

export default function UsersPage() { return <AdminOnly><Users /></AdminOnly>; }

function Users() {
  const me = useProfile();
  const users = useCollection<User>("users");
  const musicians = useCollection<Musician>("musicians");
  const { call, error, busy } = useCommand();
  const [f, setF] = useState({ email: "", name: "", role: "member", mcpAccess: false, musicianId: "" });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const r = await call("users.add", { ...f, musicianId: f.musicianId || undefined });
    if (r) setF({ email: "", name: "", role: "member", mcpAccess: false, musicianId: "" });
  }
  const free = (musicians.rows ?? []).filter((m) => !m.userId);

  return (
    <div className="grid gap-4">
      <PageTitle title="Users" sub="Who can sign in. Add a band member by their Google email." />
      <ErrorBox error={error} />
      <form onSubmit={add} className="card" data-testid="add-user">
        <span className="lbl">Add a person</span>
        <input className="input" placeholder="Google email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="user-email" />
        <input className="input" placeholder="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="user-name" />
        <div className="grid grid-cols-2 gap-2">
          <select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} data-testid="user-role">
            <option value="member">Member</option><option value="admin">Admin</option>
          </select>
          <select className="select" value={f.musicianId} onChange={(e) => setF({ ...f, musicianId: e.target.value })} data-testid="user-musician">
            <option value="">No musician link</option>
            {free.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.mcpAccess} onChange={(e) => setF({ ...f, mcpAccess: e.target.checked })} /> AI (MCP) access</label>
        <button className="btn acc" disabled={busy} data-testid="user-add">Add user</button>
      </form>
      <div className="grid gap-2" data-testid="user-list">
        {(users.rows ?? []).sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
          <div key={u.id} className="card" data-testid={`user-${u.email}`}>
            <div className="flex items-center justify-between gap-2">
              <div><b>{u.name}</b> <span className={`chip ${u.role === "admin" ? "a" : "m"}`}>{u.role}</span></div>
              {u.id !== me.uid && <button className="btn ghost sm" disabled={busy} onClick={() => confirm(`Remove ${u.name}?`) && call("users.remove", { id: u.id })}>Remove</button>}
            </div>
            <span className="s">{u.email}{u.musicianId ? ` · ${musicians.rows?.find((m) => m.id === u.musicianId)?.name ?? "musician"}` : ""}</span>
            <div className="flex flex-wrap items-center gap-3">
              <select className="select !w-auto" value={u.role} disabled={u.id === me.uid || busy} aria-label="Role"
                onChange={(e) => call("users.update", { id: u.id, patch: { role: e.target.value } })}>
                <option value="member">Member</option><option value="admin">Admin</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={u.mcpAccess} disabled={busy} onChange={(e) => call("users.update", { id: u.id, patch: { mcpAccess: e.target.checked } })} /> AI access
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
