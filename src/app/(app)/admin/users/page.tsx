"use client";
import { draftPath } from "@/schema/drafts";
import { useRef } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { SaveStatus } from "@/components/SaveStatus";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useAutosave } from "@/lib/autosave";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useProfile } from "@/lib/auth";
import type { Musician, User } from "@/schema";

export default function UsersPage() { return <AdminOnly><Users /></AdminOnly>; }

const blank = { email: "", name: "", role: "member", mcpAccess: false, musicianId: "" };

function Users() {
  const me = useProfile();
  const users = useCollection<User>("users");
  const musicians = useCollection<Musician>("musicians");
  const { call, error, busy } = useCommand();
  const d = useDraft(draftPath.newIn("users"), blank, { title: (v) => `New user${v.name ? ` · ${v.name}` : v.email ? ` · ${v.email}` : ""}` });
  const mutationId = useRef(newMutationId());
  const f = d.value;
  const setF = d.setValue;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await d.settle();
    const r = await call("users.add", { ...f, musicianId: f.musicianId || undefined }, { clientMutationId: mutationId.current, clearDraft: d.draftId });
    if (r) { await d.clear({ reset: true }); mutationId.current = newMutationId(); }
  }
  const free = (musicians.rows ?? []).filter((m) => !m.userId);

  return (
    <div className="grid gap-4">
      <PageTitle title="Users" sub="Who can sign in. Add a band member by their Google email." />
      <ErrorBox error={error} />
      {d.ready && <form onSubmit={add} className="card" data-testid="add-user">
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
        <DraftNote restoredAt={d.restoredAt} status={d.status} onStartOver={() => void d.clear({ reset: true })} />
        <button className="btn acc" disabled={busy} data-testid="user-add">Add user</button>
      </form>}
      <div className="grid gap-2" data-testid="user-list">
        {(users.rows ?? []).sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
          <UserRow key={u.id} u={u} isMe={u.id === me.uid} busy={busy} call={call} musicianName={musicians.rows?.find((m) => m.id === u.musicianId)?.name} />
        ))}
      </div>
    </div>
  );
}

/** An existing user: role and AI access save the moment they change (status + Undo like any other edit). */
function UserRow({ u, isMe, busy, call, musicianName }: { u: Row<User>; isMe: boolean; busy: boolean; call: (n: string, i: unknown) => Promise<unknown>; musicianName?: string }) {
  const as = useAutosave({ command: "users.update", id: u.id, rev: u.rev, title: u.name || u.email });
  return (
    <div className="card" data-testid={`user-${u.email}`}>
      <div className="flex items-center justify-between gap-2">
        <div><b>{u.name}</b> <span className={`chip ${u.role === "admin" ? "a" : "m"}`}>{u.role}</span></div>
        {!isMe && <button className="btn ghost sm" disabled={busy} onClick={() => confirm(`Remove ${u.name}?`) && call("users.remove", { id: u.id })}>Remove</button>}
      </div>
      <span className="s">{u.email}{u.musicianId ? ` · ${musicianName ?? "musician"}` : ""}</span>
      <div className="flex flex-wrap items-center gap-3">
        <select className="select !w-auto" value={u.role} disabled={isMe} aria-label="Role" onChange={(e) => as.patch({ role: e.target.value }, { now: true })}>
          <option value="member">Member</option><option value="admin">Admin</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={u.mcpAccess} onChange={(e) => as.patch({ mcpAccess: e.target.checked }, { now: true })} /> AI access
        </label>
        <SaveStatus {...as.statusProps} />
      </div>
    </div>
  );
}
