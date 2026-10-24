"use client";
import { draftPath } from "@/schema/drafts";
import { useRef, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { SaveStatus } from "@/components/SaveStatus";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useAutosave } from "@/lib/autosave";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useProfile } from "@/lib/auth";
import { useArtist } from "@/lib/artist";
import { roleIn, type Musician, type User } from "@/schema";

export default function PeoplePage() { return <AdminOnly><People /></AdminOnly>; }

// ── Members & logins ───────────────────────────────────────────────────────
// One form for a person: a band member (a musician record), a Roadie login (a user), or both.

const ROLES = [
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
  { value: "ai", label: "AI" },
] as const;
const roleHint = (role: string) => (role === "ai" ? "AI tools only (MCP keys). Can't sign in to the app." : null);
const chipFor = (role: string) => (role === "admin" ? "a" : role === "member" ? "m" : "");

function RoleSelect({ value, onChange, disabled, testId }: { value: string; onChange: (v: string) => void; disabled?: boolean; testId: string }) {
  return (
    <select className="select !w-auto" aria-label="Role" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
      {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
    </select>
  );
}

function Check({ checked, onChange, disabled, testId, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testId: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} /> {children}
    </label>
  );
}

const personBlank = { email: "", name: "", bandMember: false, instruments: "", invite: false, role: "member" };

function AddPerson() {
  const { call, error, busy, setError } = useCommand();
  const d = useDraft(draftPath.newIn("users"), personBlank, { title: (v) => `New person${v.name ? ` · ${v.name}` : v.email ? ` · ${v.email}` : ""}` });
  const mutationId = useRef(newMutationId());
  const f = { ...personBlank, ...d.value };
  const setF = d.setValue;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.bandMember && !f.invite) return setError("Tick band member, invite, or both");
    await d.settle();
    const meta = { clientMutationId: mutationId.current, clearDraft: d.draftId };
    const instruments = listOf(f.instruments);
    const r = f.invite
      ? await call("users.add", { email: f.email, name: f.name, role: f.role, ...(f.bandMember ? { musician: { instruments } } : {}) }, meta)
      : await call("musicians.create", { name: f.name, instruments, email: f.email || undefined, active: true }, meta);
    if (r) { await d.clear({ reset: true }); mutationId.current = newMutationId(); }
  }

  return (
    <>
      <ErrorBox error={error} />
      {d.ready && (
        <form onSubmit={add} className="card" data-testid="add-user">
          <span className="lbl">Add a person</span>
          <input className="input" placeholder="Name" aria-label="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="user-name" />
          <input className="input" placeholder="Email" aria-label="Email" type="email" required={f.invite} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="user-email" />
          <Check checked={f.bandMember} onChange={(v) => setF({ ...f, bandMember: v })} testId="user-band-member">This person is a band member</Check>
          {f.bandMember && (
            <input className="input" placeholder="Instruments (comma separated)" aria-label="Instruments" value={f.instruments} onChange={(e) => setF({ ...f, instruments: e.target.value })} data-testid="user-instruments" />
          )}
          <Check checked={f.invite} onChange={(v) => setF({ ...f, invite: v })} testId="user-invite">Invite this person to Roadie</Check>
          {f.invite && (
            <div className="flex flex-wrap items-center gap-3">
              <RoleSelect value={f.role} onChange={(v) => setF({ ...f, role: v })} testId="user-role" />
              {roleHint(f.role) && <span className="s">{roleHint(f.role)}</span>}
            </div>
          )}
          <DraftNote restoredAt={d.restoredAt} status={d.status} onStartOver={() => void d.clear({ reset: true })} />
          <button className="btn acc" disabled={busy} data-testid="user-add">Add person</button>
        </form>
      )}
    </>
  );
}

/**
 * An existing person: a login, a band member, or both. Changes to what's there save on the spot; making a new record
 * (joining the band, sending an invite) waits for its own button, like any other new record.
 */
function PersonRow({ u, m, isMe }: { u?: Row<User>; m?: Row<Musician>; isMe: boolean }) {
  const { artistId } = useArtist();
  const role = roleIn(u, artistId); // their role in this artist
  const { call, error, busy } = useCommand();
  const userAs = useAutosave({ command: "users.update", id: u?.id ?? "", rev: u?.rev, title: u?.name || u?.email });
  const musAs = useAutosave({ command: "musicians.update", id: m?.id ?? "", rev: m?.rev, title: m?.name });
  const [instr, setInstr] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [newInstr, setNewInstr] = useState("");
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState({ email: "", role: "member" });
  const name = u?.name ?? m?.name ?? "";
  const key = u?.email ?? m?.name ?? "";

  async function setBandMember(on: boolean) {
    if (on) return setJoining(true);
    if (!m) return setJoining(false);
    if (!confirm(`Take ${name} out of the band? Their musician record is archived; past shows keep it.`)) return;
    if (u && !(await call("users.update", { id: u.id, patch: { musicianId: null } }))) return;
    await call("musicians.remove", { id: m.id });
  }
  async function joinBand(e: React.FormEvent) {
    e.preventDefault();
    if (!u) return;
    const r = await call<{ id: string }>("musicians.create", { name: u.name, email: u.email, instruments: listOf(newInstr), active: true });
    if (r && (await call("users.update", { id: u.id, patch: { musicianId: r.id } }))) { setJoining(false); setNewInstr(""); }
  }
  async function setInvited(on: boolean) {
    if (on) { setInvite({ email: m?.email ?? "", role: "member" }); return setInviting(true); }
    if (!u) return setInviting(false);
    if (!confirm(`Remove ${name}'s Roadie login?${m ? " They stay in the band." : ""}`)) return;
    await call("users.remove", { id: u.id });
  }
  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!m) return;
    if (await call("users.add", { email: invite.email, name: m.name, role: invite.role, musicianId: m.id })) setInviting(false);
  }

  return (
    <div className="card" data-testid={`person-${key}`}>
      <div className="flex items-center justify-between gap-2">
        <div><b>{name}</b> {u && <span className={`chip ${chipFor(role)}`} data-testid="person-role-chip">{role}</span>}{" "}{m && !m.active && <span className="chip">inactive</span>}</div>
      </div>
      {u && <span className="s">{u.email}</span>}
      <ErrorBox error={error} />

      <Check checked={!!m || joining} disabled={busy} onChange={(v) => void setBandMember(v)} testId="person-band-member">This person is a band member</Check>
      {m ? (
        <div className="grid gap-1" data-testid="person-musician">
          <input className="input" aria-label="Instruments" placeholder="Instruments (comma separated)" value={instr ?? m.instruments.join(", ")} data-testid="person-instruments"
            onChange={(e) => { setInstr(e.target.value); musAs.patch({ instruments: listOf(e.target.value) }); }}
            onBlur={() => { void musAs.flush(); setInstr(null); }} />
          <SaveStatus {...musAs.statusProps} />
        </div>
      ) : joining && (
        <form onSubmit={joinBand} className="flex flex-wrap gap-2">
          <input className="input flex-1" aria-label="Instruments" placeholder="Instruments (comma separated)" value={newInstr} onChange={(e) => setNewInstr(e.target.value)} data-testid="person-new-instruments" />
          <button className="btn acc sm" disabled={busy} data-testid="person-join">Add to band</button>
        </form>
      )}

      <Check checked={!!u || inviting} disabled={busy || isMe} onChange={(v) => void setInvited(v)} testId="person-invite">Invite this person to Roadie</Check>
      {u ? (
        <div className="flex flex-wrap items-center gap-3" data-testid="person-login">
          <RoleSelect value={role} disabled={isMe} onChange={(v) => userAs.patch({ role: v }, { now: true })} testId="person-role" />
          {role === "ai" ? <span className="s">{roleHint("ai")}</span> : (
            <Check checked={u.mcpAccess} onChange={(v) => userAs.patch({ mcpAccess: v }, { now: true })} testId="person-mcp">AI (MCP) access</Check>
          )}
          <SaveStatus {...userAs.statusProps} />
        </div>
      ) : inviting && (
        <form onSubmit={sendInvite} className="grid gap-2">
          <input className="input" placeholder="Email" aria-label="Email" type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} data-testid="person-invite-email" />
          <div className="flex flex-wrap items-center gap-3">
            <RoleSelect value={invite.role} onChange={(v) => setInvite({ ...invite, role: v })} testId="person-invite-role" />
            {roleHint(invite.role) && <span className="s">{roleHint(invite.role)}</span>}
            <button className="btn acc sm" disabled={busy} data-testid="person-send-invite">Invite</button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Musicians ──────────────────────────────────────────────────────────────

const musicianBlank = { name: "", instruments: "", email: "", phone: "", payHandle: "" };
const listOf = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const emptyToNull = (s: string) => (s.trim() ? s.trim() : null);

function AddMusician() {
  const { call, error, busy } = useCommand();
  const d = useDraft(draftPath.newIn("musicians"), musicianBlank, { title: (v) => `New musician${v.name ? ` · ${v.name}` : ""}` });
  const mutationId = useRef(newMutationId());
  const f = d.value;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await d.settle();
    const r = await call("musicians.create", {
      name: f.name, instruments: listOf(f.instruments),
      email: f.email || undefined, phone: f.phone || undefined, payHandle: f.payHandle || undefined, active: true,
    }, { clientMutationId: mutationId.current, clearDraft: d.draftId });
    if (r) { await d.clear({ reset: true }); mutationId.current = newMutationId(); }
  }

  return (
    <>
      <ErrorBox error={error} />
      {d.ready && (
        <form onSubmit={add} className="card" data-testid="add-musician">
          <span className="lbl">Add a musician or sub</span>
          <input className="input" placeholder="Name" required value={f.name} onChange={(e) => d.setValue({ ...f, name: e.target.value })} data-testid="musician-name" />
          <input className="input" placeholder="Instruments (comma separated)" value={f.instruments} onChange={(e) => d.setValue({ ...f, instruments: e.target.value })} data-testid="musician-instruments" />
          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder="Email (optional)" type="email" value={f.email} onChange={(e) => d.setValue({ ...f, email: e.target.value })} />
            <input className="input" placeholder="Phone (optional)" value={f.phone} onChange={(e) => d.setValue({ ...f, phone: e.target.value })} />
          </div>
          <input className="input" placeholder="Venmo handle (optional)" value={f.payHandle} onChange={(e) => d.setValue({ ...f, payHandle: e.target.value })} />
          <DraftNote restoredAt={d.restoredAt} status={d.status} onStartOver={() => void d.clear({ reset: true })} />
          <button className="btn acc" disabled={busy} data-testid="musician-add">Add musician</button>
        </form>
      )}
    </>
  );
}

function MusicianRow({ m, busy, call }: { m: Row<Musician>; busy: boolean; call: (n: string, i: unknown) => Promise<unknown> }) {
  const as = useAutosave({ command: "musicians.update", id: m.id, rev: m.rev, title: m.name });
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [instr, setInstr] = useState<string | null>(null);
  const shown = (v: string | null, live: string) => v ?? live;
  return (
    <div className="card" data-testid={`musician-${m.name}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <b>{m.name}</b>{" "}
          {m.userId ? <span className="chip g">has login</span> : <span className="chip">no login (sub)</span>}{" "}
          {!m.active && <span className="chip">inactive</span>}
        </div>
        <div className="flex gap-2">
          <button className="btn ghost sm" onClick={() => setEdit(!edit)} data-testid="musician-edit">{edit ? "Done" : "Edit"}</button>
          <button className="btn ghost sm" onClick={() => as.patch({ active: !m.active }, { now: true })} data-testid="musician-active">{m.active ? "Set inactive" : "Set active"}</button>
          <button className="btn danger sm" disabled={busy} onClick={() => confirm(`Archive ${m.name}?`) && call("musicians.remove", { id: m.id })}>Archive</button>
        </div>
      </div>
      {edit ? (
        <div className="grid gap-2">
          <input className="input" aria-label="Name" value={shown(name, m.name)} data-testid="musician-edit-name"
            onChange={(e) => { const v = e.target.value; setName(v); if (v.trim()) as.patch({ name: v }); else as.hold("Name is required"); }}
            onBlur={() => { void as.flush(); if (name?.trim()) setName(null); }} />
          <input className="input" aria-label="Instruments" placeholder="Instruments (comma separated)" value={shown(instr, m.instruments.join(", "))} data-testid="musician-edit-instruments"
            onChange={(e) => { setInstr(e.target.value); as.patch({ instruments: listOf(e.target.value) }); }}
            onBlur={() => { void as.flush(); setInstr(null); }} />
          <div className="grid grid-cols-2 gap-2">
            <input className="input" aria-label="Email" placeholder="Email" type="email" data-testid="musician-edit-email" {...as.bind("email", m.email ?? "", { toPatch: emptyToNull })} />
            <input className="input" aria-label="Phone" placeholder="Phone" data-testid="musician-edit-phone" {...as.bind("phone", m.phone ?? "", { toPatch: emptyToNull })} />
          </div>
          <input className="input" aria-label="Venmo handle" placeholder="Venmo handle" data-testid="musician-edit-payHandle" {...as.bind("payHandle", m.payHandle ?? "", { toPatch: emptyToNull })} />
        </div>
      ) : (
        <span className="s">{[m.instruments.join(", "), m.email, m.phone, m.payHandle].filter(Boolean).join(" · ")}</span>
      )}
      <SaveStatus {...as.statusProps} />
    </div>
  );
}

// ── Combined page ──────────────────────────────────────────────────────────

function People() {
  const me = useProfile();
  const { artistId } = useArtist();
  // Everyone with a login in this artist (users docs are shared by all the artists a person belongs to).
  const all = useCollection<User>("users");
  const users = { ...all, rows: all.rows?.filter((u) => roleIn(u, artistId)) ?? null };
  const musicians = useCollection<Musician>("musicians");
  const { call, busy } = useCommand();

  const live = new Map((musicians.rows ?? []).map((m) => [m.id, m]));
  const userIds = new Set((users.rows ?? []).map((u) => u.id));
  const people = [
    ...(users.rows ?? []).map((u) => ({ id: u.id, name: u.name, u, m: u.musicianId ? live.get(u.musicianId) : undefined })),
    ...(musicians.rows ?? []).filter((m) => !m.userId || !userIds.has(m.userId)).map((m) => ({ id: m.id, name: m.name, u: undefined, m })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="grid gap-6">
      <PageTitle title="People" sub="Band members and who can log in to Roadie, plus every musician (including subs who don't need a login)." />

      <section className="grid gap-3">
        <h2 className="font-display text-base font-bold">Members &amp; logins</h2>
        <AddPerson />
        <div className="grid gap-2" data-testid="user-list">
          {people.map((p) => <PersonRow key={p.id} u={p.u} m={p.m} isMe={p.u?.id === me.uid} />)}
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="font-display text-base font-bold">Musicians &amp; subs</h2>
        <AddMusician />
        <div className="grid gap-2" data-testid="musician-list">
          {(musicians.rows ?? []).sort((a, b) => a.name.localeCompare(b.name)).map((m) => (
            <MusicianRow key={m.id} m={m} busy={busy} call={call} />
          ))}
        </div>
      </section>
    </div>
  );
}
