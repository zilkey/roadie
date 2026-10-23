"use client";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection } from "@/lib/firestore-hooks";
import type { Musician } from "@/schema";

export default function MusiciansPage() { return <AdminOnly><Musicians /></AdminOnly>; }

const blank = { name: "", instruments: "", email: "", phone: "", payHandle: "" };

function Musicians() {
  const { rows } = useCollection<Musician>("musicians");
  const { call, error, busy } = useCommand();
  const [f, setF] = useState(blank);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const r = await call("musicians.create", {
      name: f.name, instruments: f.instruments.split(",").map((s) => s.trim()).filter(Boolean),
      email: f.email || undefined, phone: f.phone || undefined, payHandle: f.payHandle || undefined, active: true,
    });
    if (r) setF(blank);
  }

  return (
    <div className="grid gap-4">
      <PageTitle title="Musicians" sub="Anyone who plays. Subs don't need a login." />
      <ErrorBox error={error} />
      <form onSubmit={add} className="card" data-testid="add-musician">
        <span className="lbl">Add a musician or sub</span>
        <input className="input" placeholder="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="musician-name" />
        <input className="input" placeholder="Instruments (comma separated)" value={f.instruments} onChange={(e) => setF({ ...f, instruments: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder="Email (optional)" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input className="input" placeholder="Phone (optional)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </div>
        <input className="input" placeholder="Venmo handle (optional)" value={f.payHandle} onChange={(e) => setF({ ...f, payHandle: e.target.value })} />
        <button className="btn acc" disabled={busy} data-testid="musician-add">Add musician</button>
      </form>
      <div className="grid gap-2" data-testid="musician-list">
        {(rows ?? []).sort((a, b) => a.name.localeCompare(b.name)).map((m) => (
          <div key={m.id} className="card" data-testid={`musician-${m.name}`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <b>{m.name}</b>{" "}
                {m.userId ? <span className="chip g">has login</span> : <span className="chip">no login (sub)</span>}{" "}
                {!m.active && <span className="chip">inactive</span>}
              </div>
              <div className="flex gap-2">
                <button className="btn ghost sm" disabled={busy} onClick={() => call("musicians.update", { id: m.id, patch: { active: !m.active } })}>{m.active ? "Set inactive" : "Set active"}</button>
                <button className="btn ghost sm" disabled={busy} onClick={() => confirm(`Archive ${m.name}?`) && call("musicians.remove", { id: m.id })}>Archive</button>
              </div>
            </div>
            <span className="s">{[m.instruments.join(", "), m.email, m.phone, m.payHandle].filter(Boolean).join(" · ")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
