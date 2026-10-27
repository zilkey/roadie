"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { draftPath } from "@/schema/drafts";
import { Dialog, ErrorBox, useCommand } from "@/components/ui";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { FormFields, contactForm, useBooking, type Values } from "@/components/booking/common";
import { useDraft, useHasDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { CONTACT_ROLES, ROLE_LABEL, type ContactRole } from "@/lib/venues";

type Kind = "venues" | "promoters" | "festivals";
const NOUN: Record<Kind, string> = { venues: "venue", promoters: "promoter", festivals: "festival" };
type Mode = "exist" | "new";

/**
 * The dialog behind the Contacts card's plus. "Already in Contacts" finds someone in the band's contacts who isn't on this place yet
 * (by name, email or where they work) and links them; "New person" is the contact form with its draft and an explicit "Add contact".
 * On a venue both halves also set the person's roles here. Cancel and × close; a half-finished new person stays a draft, and a draft
 * found when the page loads opens the dialog on "New person" (`onWantOpen`).
 */
export function AddContactDialog({ kind, parentId, parentName, open, onClose, onWantOpen }: {
  kind: Kind; parentId: string; parentName: string; open: boolean; onClose(): void;
  /** Called once, when an unfinished new person is waiting for this place on page load. */
  onWantOpen?(): void;
}) {
  const path = draftPath.newUnder(kind, parentId, "contacts");
  const hasDraft = useHasDraft(path);
  const [mode, setMode] = useState<Mode>("exist");
  const [roles, setRoles] = useState<ContactRole[]>(["booking"]);
  const { call, error, busy, setError } = useCommand();
  const asked = useRef(false); // the page-load draft opens the dialog once; after that a kept draft waits for the plus
  useEffect(() => { if (open) asked.current = true; }, [open]);
  useEffect(() => {
    if (hasDraft && !open && !asked.current) { asked.current = true; setMode("new"); onWantOpen?.(); }
  }, [hasDraft, open, onWantOpen]);
  const formId = useId();
  const noun = NOUN[kind];

  function close() { setError(null); setRoles(["booking"]); setMode("exist"); onClose(); }
  /** After the link: a venue's roles for this person (none ticked = nothing to send). */
  async function applyRoles(contactId: string) {
    if (kind !== "venues" || roles.length === 0) return true;
    return !!(await call("contacts.setRoles", { contactId, venueId: parentId, roles }));
  }

  return (
    <Dialog open={open} onClose={close} title="Add a contact" testid="contact-add-dialog">
      <DialogClose onClose={close} testid="contact-add-close" />
      <span className="s -mt-2">To {parentName}</span>
      <div className="seg wide" role="radiogroup" aria-label="Who">
        <label><input type="radio" name={`${formId}-mode`} checked={mode === "exist"} onChange={() => setMode("exist")} data-testid="contact-add-exist" />Already in Contacts</label>
        <label><input type="radio" name={`${formId}-mode`} checked={mode === "new"} onChange={() => setMode("new")} data-testid="contact-add-new" />New person</label>
      </div>
      {mode === "exist"
        ? <ExistingPicker kind={kind} parentId={parentId} busy={busy} addLabel={`Add to ${noun}`} rolesBox={kind === "venues" && <RolesBox roles={roles} set={setRoles} />}
          onCancel={close} onPick={async (contactId) => {
            const r = await call("contacts.attach", { contactId, kind, id: parentId });
            if (r && (await applyRoles(contactId))) close();
          }} />
        : <NewPersonForm path={path} formId={formId} busy={busy} rolesBox={kind === "venues" && <RolesBox roles={roles} set={setRoles} />}
          onCancel={close} onCreate={async (data, meta) => {
            const r = await call<{ id: string }>("contacts.create", { ...data, attachTo: { kind, id: parentId } }, meta);
            if (!r) return false;
            if (await applyRoles(r.id)) close();
            return true; // the contact exists: the draft goes even if the roles need another try
          }} />}
      <ErrorBox error={error} />
    </Dialog>
  );
}

/** Find someone the band already has and pick one: the "Already in …" half, kept generic enough for the other list cards. */
function ExistingPicker({ kind, parentId, busy, addLabel, rolesBox, onPick, onCancel }: {
  kind: Kind; parentId: string; busy: boolean; addLabel: string; rolesBox: React.ReactNode; onPick(id: string): Promise<void>; onCancel(): void;
}) {
  const b = useBooking();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const linked = useMemo(() => new Set(b[kind].find((p) => p.id === parentId)?.contactIds ?? []), [b, kind, parentId]);
  /** contact id → the places they're on, for the hit line and the search. */
  const works = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of [...b.venues, ...b.promoters, ...b.festivals]) for (const c of p.contactIds ?? []) m.set(c, [...(m.get(c) ?? []), p.name]);
    return m;
  }, [b.venues, b.promoters, b.festivals]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = b.contacts
    .filter((c) => !linked.has(c.id))
    .filter((c) => words.every((w) => [c.name, ...c.emails, ...(works.get(c.id) ?? [])].join(" ").toLowerCase().includes(w)))
    .sort((a, c) => a.name.localeCompare(c.name))
    .slice(0, 8);
  return (
    <>
      <label className="grid gap-1">
        <span className="lbl">Find them</span>
        <input className="input" placeholder="Name, email or where they work" value={q} autoFocus data-testid="contact-find"
          onChange={(e) => { setQ(e.target.value); setPicked(null); }} />
      </label>
      <div className="hit-list" data-testid="contact-hits">
        {hits.length === 0 && <span className="s p-3">{q.trim() ? "No one matches." : "Everyone in Contacts is already here."}</span>}
        {hits.map((c) => {
          const where = [works.get(c.id)?.join(", "), c.title].filter(Boolean).join(" · ");
          return (
            <button key={c.id} type="button" className="hit-row" aria-pressed={picked === c.id} onClick={() => setPicked(c.id)} data-testid={`contact-hit-${c.id}`}>
              <span className="grid min-w-0 gap-px"><b>{c.name}</b>{where && <span className="s">{where}</span>}</span>
              {c.emails[0] && <span className="s font-mono break-all">{c.emails[0]}</span>}
            </button>
          );
        })}
      </div>
      {rolesBox}
      <DialogFoot onCancel={onCancel}>
        <button type="button" className="btn acc" disabled={busy || !picked} onClick={() => picked && onPick(picked)} data-testid="contact-add-submit">{addLabel}</button>
      </DialogFoot>
    </>
  );
}

/** A new person: the contact form's fields, kept as a draft (device + server) until "Add contact" creates them. */
function NewPersonForm({ path, formId, busy, rolesBox, onCreate, onCancel }: {
  path: string; formId: string; busy: boolean; rolesBox: React.ReactNode; onCancel(): void;
  onCreate(data: Record<string, unknown>, meta: { clientMutationId: string; clearDraft: string }): Promise<boolean>;
}) {
  const d = useDraft<Values>(path, contactForm.blank, { title: (v) => `New contact${v.name ? ` · ${v.name}` : ""}` });
  const mutationId = useRef(newMutationId());
  const [sending, setSending] = useState(false);
  if (!d.ready) return <div className="s">Loading…</div>;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSending(true);
    try {
      await d.settle();
      if (await onCreate(contactForm.build(d.value), { clientMutationId: mutationId.current, clearDraft: d.draftId })) {
        await d.clear({ reset: true }); mutationId.current = newMutationId();
      }
    } finally { setSending(false); }
  }
  return (
    <>
      <form id={formId} onSubmit={submit} className="grid gap-2" data-testid="contact-form">
        <FormFields fields={contactForm.fields} v={d.value} set={(k, val) => d.setValue((x) => ({ ...x, [k]: val }))} testid="contact-form" />
        <span className="s">Half-finished? It&apos;s kept as a draft until you press Add contact.</span>
        <DraftNote restoredAt={d.restoredAt} status={d.status} onStartOver={() => void d.clear({ reset: true })} />
      </form>
      {rolesBox}
      <DialogFoot onCancel={onCancel}>
        <button type="submit" form={formId} className="btn acc" disabled={busy || sending} data-testid="contact-add-submit">Add contact</button>
      </DialogFoot>
    </>
  );
}

function RolesBox({ roles, set }: { roles: ContactRole[]; set(r: ContactRole[]): void }) {
  return (
    <fieldset className="grid gap-0.5">
      <legend className="lbl">Role at this venue</legend>
      <div className="flex flex-wrap gap-x-5">
        {CONTACT_ROLES.map((r) => (
          <label key={r} className="flex min-h-[44px] cursor-pointer items-center gap-2 font-semibold">
            <input type="checkbox" checked={roles.includes(r)} data-testid={`contact-add-${r}`}
              onChange={(e) => set(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />
            {ROLE_LABEL[r]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The × in a dialog's top corner. */
export function DialogClose({ onClose, testid }: { onClose(): void; testid?: string }) {
  return (
    <button type="button" className="ib dlg-x" aria-label="Close" onClick={onClose} data-testid={testid}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
    </button>
  );
}

/** Cancel on the left, the dialog's one primary button on the right. */
export function DialogFoot({ onCancel, cancelTestid = "contact-add-cancel", children }: { onCancel(): void; cancelTestid?: string; children: React.ReactNode }) {
  return (
    <div className="dlg-foot">
      <button type="button" className="btn ghost" onClick={onCancel} data-testid={cancelTestid}>Cancel</button>
      {children}
    </div>
  );
}
