"use client";
import { draftPath } from "@/schema/drafts";
import { useEffect, useRef, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection, type Row } from "@/lib/firestore-hooks";
import { BackLink } from "@/components/booking/common";
import { SaveStatus } from "@/components/SaveStatus";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useAutosave } from "@/lib/autosave";
import { useDraft, useHasDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { TEMPLATE_FIELDS } from "@/lib/booking";
import type { EmailTemplate } from "@/schema";

export default function Page() { return <AdminOnly><Templates /></AdminOnly>; }

const KINDS = [["venue", "Venues"], ["promoter", "Promoters"], ["edition", "Festival years"]] as const;
type T = Pick<EmailTemplate, "name" | "subject" | "body" | "targetKinds">;
const blank: T = { name: "", subject: "", body: "", targetKinds: [] };

function Templates() {
  const { rows } = useCollection<EmailTemplate>("emailTemplates");
  const { call, error } = useCommand();
  const [editing, setEditing] = useState<string | null>(null);
  const hasDraft = useHasDraft(draftPath.newIn("emailTemplates"));
  const [explicit, setAdding] = useState<boolean | null>(null);
  const adding = explicit ?? hasDraft; // an unfinished template opens the form
  const sorted = [...(rows ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="grid gap-3">
      <BackLink href="/booking" label="Booking" />
      <PageTitle title="Email templates" sub="Fill-in fields like {{venue.name}} are replaced when you send." />
      <ErrorBox error={error} />
      <div className="card"><span className="lbl">Fields you can use</span><span className="font-mono text-xs break-words">{TEMPLATE_FIELDS.map((f) => `{{${f}}}`).join("  ")}</span></div>
      <div className="grid gap-2" data-testid="template-list">
        {sorted.map((t) => editing === t.id ? (
          <TemplateEditor key={t.id} t={t} onDone={() => setEditing(null)} />
        ) : (
          <TemplateCard key={t.id} t={t} onEdit={() => setEditing(t.id)} onDelete={() => confirm(`Delete "${t.name}"?`) && call("emailTemplates.remove", { id: t.id })} />
        ))}
      </div>
      {adding ? (
        <NewTemplate onDone={() => setAdding(false)} />
      ) : <button className="btn ghost justify-self-start" onClick={() => setAdding(true)} data-testid="template-new">+ New template</button>}
    </div>
  );
}

function TemplateCard({ t, onEdit, onDelete }: { t: Row<EmailTemplate>; onEdit(): void; onDelete(): void }) {
  return (
    <div className="card" data-testid={`template-${t.name}`}>
      <div className="flex items-center justify-between gap-2">
        <b>{t.name}</b>
        <span className="flex gap-2"><button className="btn ghost sm" onClick={onEdit} data-testid="template-edit">Edit</button><button className="btn ghost sm" onClick={onDelete}>Delete</button></span>
      </div>
      <span className="s">{t.subject}</span>
      <pre className="s whitespace-pre-wrap font-sans">{t.body}</pre>
    </div>
  );
}

function Kinds({ value, onChange }: { value: T["targetKinds"]; onChange(v: T["targetKinds"]): void }) {
  return (
    <div className="flex flex-wrap gap-3 text-sm">
      <span className="lbl">Offer for</span>
      {KINDS.map(([k, l]) => (
        <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={value.includes(k)} data-testid={`template-kind-${k}`}
          onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} />{l}</label>
      ))}
      <span className="s">(none ticked = everything)</span>
    </div>
  );
}

/** An existing template: each field saves on its own. */
function TemplateEditor({ t, onDone }: { t: Row<EmailTemplate>; onDone(): void }) {
  const as = useAutosave({ command: "emailTemplates.update", id: t.id, rev: t.rev, title: t.name });
  const [name, setName] = useState<string | null>(null); // a name being typed (it may not be saved while empty)
  useEffect(() => { if (name !== null && name === t.name) setName(null); }, [t.name, name]);
  const keep = (s: string) => s;
  return (
    <form className="card" data-testid="template-form" onSubmit={(e) => e.preventDefault()}>
      <input className="input" placeholder="Name (e.g. First pitch)" value={name ?? t.name} data-testid="template-name"
        onChange={(e) => { const v = e.target.value; setName(v); if (v.trim()) as.patch({ name: v }); else as.hold("Name is required"); }} onBlur={() => void as.flush()} />
      <input className="input" placeholder="Subject" data-testid="template-subject" {...as.bind("subject", t.subject, { toPatch: keep })} />
      <textarea className="input" rows={7} placeholder="Message" data-testid="template-body" {...as.bind("body", t.body, { toPatch: keep })} />
      <Kinds value={t.targetKinds} onChange={(targetKinds) => as.patch({ targetKinds }, { now: true })} />
      <div className="flex items-center gap-2"><SaveStatus {...as.statusProps} /><button type="button" className="btn ghost sm" onClick={onDone} data-testid="template-done">Done</button></div>
    </form>
  );
}

/** A new template is a draft until Add. */
function NewTemplate({ onDone }: { onDone(): void }) {
  const { call, busy } = useCommand();
  const d = useDraft<T>(draftPath.newIn("emailTemplates"), blank, { title: (v) => `New template${v.name ? ` · ${v.name}` : ""}` });
  const mutationId = useRef(newMutationId());
  if (!d.ready) return <div className="card s">Loading…</div>;
  const v = d.value;
  async function add(e: React.FormEvent) {
    e.preventDefault();
    await d.settle();
    const r = await call("emailTemplates.create", d.value, { clientMutationId: mutationId.current, clearDraft: d.draftId });
    if (r) { await d.clear({ reset: true }); mutationId.current = newMutationId(); onDone(); }
  }
  return (
    <form className="card" data-testid="template-form" onSubmit={add}>
      <input className="input" placeholder="Name (e.g. First pitch)" required value={v.name} onChange={(e) => d.setValue({ ...v, name: e.target.value })} data-testid="template-name" />
      <input className="input" placeholder="Subject" value={v.subject} onChange={(e) => d.setValue({ ...v, subject: e.target.value })} data-testid="template-subject" />
      <textarea className="input" rows={7} placeholder="Message" value={v.body} onChange={(e) => d.setValue({ ...v, body: e.target.value })} data-testid="template-body" />
      <Kinds value={v.targetKinds} onChange={(targetKinds) => d.setValue({ ...v, targetKinds })} />
      <DraftNote restoredAt={d.restoredAt} status={d.status} onStartOver={() => void d.clear({ reset: true })} />
      <div className="flex gap-2"><button className="btn acc" disabled={busy} data-testid="template-save">Add template</button><button type="button" className="btn ghost" onClick={onDone}>Close</button></div>
    </form>
  );
}
