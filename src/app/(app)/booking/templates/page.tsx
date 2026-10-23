"use client";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { BackLink } from "@/components/booking/common";
import { TEMPLATE_FIELDS } from "@/lib/booking";
import type { EmailTemplate } from "@/schema";

export default function Page() { return <AdminOnly><Templates /></AdminOnly>; }

const KINDS = [["venue", "Venues"], ["promoter", "Promoters"], ["edition", "Festival years"]] as const;
type T = Pick<EmailTemplate, "name" | "subject" | "body" | "targetKinds">;
const blank: T = { name: "", subject: "", body: "", targetKinds: [] };

function Templates() {
  const { rows } = useCollection<EmailTemplate>("emailTemplates");
  const { call, error, busy } = useCommand();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const sorted = [...(rows ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="grid gap-3">
      <BackLink href="/booking" label="Booking" />
      <PageTitle title="Email templates" sub="Fill-in fields like {{venue.name}} are replaced when you send." />
      <ErrorBox error={error} />
      <div className="card"><span className="lbl">Fields you can use</span><span className="font-mono text-xs break-words">{TEMPLATE_FIELDS.map((f) => `{{${f}}}`).join("  ")}</span></div>
      <div className="grid gap-2" data-testid="template-list">
        {sorted.map((t) => editing === t.id ? (
          <TemplateForm key={t.id} initial={t} busy={busy} label="Save" onCancel={() => setEditing(null)}
            onSave={async (v) => { if (await call("emailTemplates.update", { id: t.id, patch: v })) setEditing(null); }} />
        ) : (
          <TemplateCard key={t.id} t={t} onEdit={() => setEditing(t.id)} onDelete={() => confirm(`Delete "${t.name}"?`) && call("emailTemplates.remove", { id: t.id })} />
        ))}
      </div>
      {editing === "new" ? (
        <TemplateForm initial={blank} busy={busy} label="Add template" onCancel={() => setEditing(null)}
          onSave={async (v) => { if (await call("emailTemplates.create", v)) setEditing(null); }} />
      ) : <button className="btn ghost justify-self-start" onClick={() => setEditing("new")} data-testid="template-new">+ New template</button>}
    </div>
  );
}

function TemplateCard({ t, onEdit, onDelete }: { t: Row<EmailTemplate>; onEdit(): void; onDelete(): void }) {
  return (
    <div className="card" data-testid={`template-${t.name}`}>
      <div className="flex items-center justify-between gap-2">
        <b>{t.name}</b>
        <span className="flex gap-2"><button className="btn ghost sm" onClick={onEdit}>Edit</button><button className="btn ghost sm" onClick={onDelete}>Delete</button></span>
      </div>
      <span className="s">{t.subject}</span>
      <pre className="s whitespace-pre-wrap font-sans">{t.body}</pre>
    </div>
  );
}

function TemplateForm({ initial, onSave, onCancel, busy, label }: { initial: T; onSave(v: T): Promise<void>; onCancel(): void; busy: boolean; label: string }) {
  const [v, setV] = useState<T>({ name: initial.name, subject: initial.subject, body: initial.body, targetKinds: initial.targetKinds });
  return (
    <form className="card" data-testid="template-form" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <input className="input" placeholder="Name (e.g. First pitch)" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} data-testid="template-name" />
      <input className="input" placeholder="Subject" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} data-testid="template-subject" />
      <textarea className="input" rows={7} placeholder="Message" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} data-testid="template-body" />
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="lbl">Offer for</span>
        {KINDS.map(([k, l]) => (
          <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={v.targetKinds.includes(k)}
            onChange={(e) => setV({ ...v, targetKinds: e.target.checked ? [...v.targetKinds, k] : v.targetKinds.filter((x) => x !== k) })} />{l}</label>
        ))}
        <span className="s">(none ticked = everything)</span>
      </div>
      <div className="flex gap-2"><button className="btn acc" disabled={busy} data-testid="template-save">{label}</button><button type="button" className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}
