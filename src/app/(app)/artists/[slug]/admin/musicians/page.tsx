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
import type { Musician } from "@/schema";

export default function MusiciansPage() { return <AdminOnly><Musicians /></AdminOnly>; }

const blank = { name: "", instruments: "", email: "", phone: "", payHandle: "" };

const listOf = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const emptyToNull = (s: string) => (s.trim() ? s.trim() : null);

function Musicians() {
  const { rows } = useCollection<Musician>("musicians");
  const { call, error, busy } = useCommand();
  const d = useDraft(draftPath.newIn("musicians"), blank, { title: (v) => `New musician${v.name ? ` · ${v.name}` : ""}` });
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
    <div className="grid gap-4">
      <PageTitle title="Musicians" sub="Anyone who plays. Subs don't need a login." />
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
      <div className="grid gap-2" data-testid="musician-list">
        {(rows ?? []).sort((a, b) => a.name.localeCompare(b.name)).map((m) => <MusicianRow key={m.id} m={m} busy={busy} call={call} />)}
      </div>
    </div>
  );
}

/** An existing musician: each field saves on its own. */
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
          <button className="btn ghost sm" disabled={busy} onClick={() => confirm(`Archive ${m.name}?`) && call("musicians.remove", { id: m.id })}>Archive</button>
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
