"use client";
import { useRef, useState } from "react";
import { draftPath } from "@/schema/drafts";
import { validatePerson } from "@/schema";
import { newMutationId } from "@/lib/commands";
import { useDraft } from "@/lib/drafts";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { CloseIcon } from "@/components/Sheet";
import { ErrorBox } from "@/components/ui";
import { FieldError, TextField, invalid, useAct } from "./shared";

const blank = { name: "", bandMember: false, team: false, instruments: "", email: "", role: "member", mcpAccess: false };

/** "Add a person": a Band Member, Team access, or both. Nothing is created until Add person is pressed. */
export function AddPerson({ onClose }: { onClose(): void }) {
  const { act, busy, error, fields, reset } = useAct();
  const d = useDraft(draftPath.newIn("users"), blank, { title: (v) => `New person${v.name ? ` · ${v.name}` : v.email ? ` · ${v.email}` : ""}` });
  const mutationId = useRef(newMutationId());
  const [local, setLocal] = useState<Record<string, string>>({});
  const f = { ...blank, ...d.value };
  const errs = { ...fields, ...local };
  const set = (patch: Partial<typeof blank>, clear: string[] = []) => {
    d.setValue({ ...f, ...patch });
    if (clear.length) setLocal((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !clear.includes(k))));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    reset();
    const v = validatePerson(f);
    if (v.errors) {
      setLocal(v.errors);
      const first = ["name", "kind", "instruments", "email"].find((k) => v.errors![k]);
      document.getElementById(first === "kind" ? "add-kind" : `add-${first}`)?.focus();
      return;
    }
    setLocal({});
    await d.settle();
    const { name, bandMember, team, instruments, email, role, mcpAccess } = v.values;
    const meta = { clientMutationId: mutationId.current, clearDraft: d.draftId };
    const r = team
      ? await act("users.add", { email, name, role, mcpAccess, ...(bandMember ? { musician: { instruments } } : {}) }, meta)
      : await act("musicians.create", { name, instruments }, meta);
    if (r) { await d.clear({ reset: true }); mutationId.current = newMutationId(); onClose(); }
  }
  async function cancel() { await d.clear({ reset: true }); onClose(); }

  if (!d.ready) return null;
  return (
    <form onSubmit={submit} noValidate className="card" style={{ maxWidth: 760 }} data-testid="add-user" aria-labelledby="add-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="add-title" className="text-lg">Add a person</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} data-testid="user-close"><CloseIcon /></button>
      </div>
      <ErrorBox error={error} />
      <TextField id="add-name" label="Name" value={f.name} onChange={(v) => set({ name: v }, ["name"])} error={errs.name} field="name" testid="user-name" />

      <fieldset className="grid gap-2 border-0 p-0 m-0 min-w-0" id="add-kind" tabIndex={-1} aria-describedby={errs.kind ? "add-kind-err" : undefined}>
        <legend className="lbl p-0">What is this person? <span className="font-normal">Pick one or both.</span></legend>
        <div className="kind" data-on={f.bandMember ? "1" : "0"} data-k="band">
          <label className="kind-head">
            <input type="checkbox" checked={f.bandMember} onChange={(e) => set({ bandMember: e.target.checked }, ["kind", "instruments"])} data-testid="user-band-member" />
            <span className="grid"><b>Band Member</b><span className="s">Plays in the band. Appears in show lineups, setlists and pay. Use this for subs too.</span></span>
          </label>
          {f.bandMember && (
            <TextField id="add-instruments" label="Instruments · required" value={f.instruments} onChange={(v) => set({ instruments: v }, ["instruments"])} error={errs.instruments} field="instruments" testid="user-instruments" hint="Separate with commas." />
          )}
        </div>
        <div className="kind" data-on={f.team ? "1" : "0"} data-k="team">
          <label className="kind-head">
            <input type="checkbox" checked={f.team} onChange={(e) => set({ team: e.target.checked }, ["kind", "email"])} data-testid="user-team" />
            <span className="grid"><b>Team</b><span className="s">Can sign in to Roadie and see this band. Nothing is emailed; they just sign in with this address.</span></span>
          </label>
          {f.team && (
            <>
              <TextField id="add-email" label="Email · required" type="email" value={f.email} onChange={(v) => set({ email: v }, ["email"])} error={errs.email} field="email" testid="user-email" />
              <fieldset className="grid gap-2 border-0 p-0 m-0 min-w-0" aria-describedby={errs.role ? "add-role-err" : undefined}>
                <legend className="lbl p-0 mb-1">Access level</legend>
                <label className="opt">
                  <input type="radio" name="add-role" checked={f.role === "member"} onChange={() => set({ role: "member", mcpAccess: false }, ["role", "mcpAccess"])} data-testid="user-role-member" />
                  <span className="grid"><b>Standard</b><span className="s">Can see their earnings and expenses and shows, but can&apos;t book or see other finances</span></span>
                </label>
                <label className="opt">
                  <input type="radio" name="add-role" checked={f.role === "admin"} onChange={() => set({ role: "admin" }, ["role"])} data-testid="user-role-admin" />
                  <span className="grid"><b>Admin</b><span className="s">Everything, including people, money and band settings.</span></span>
                </label>
                <FieldError id="add-role" field="role" error={errs.role} />
                {f.role === "admin" && (
                  <label className="check ml-7">
                    <input type="checkbox" checked={f.mcpAccess} onChange={(e) => set({ mcpAccess: e.target.checked }, ["mcpAccess"])} data-testid="user-mcp" {...invalid("add-mcp", errs.mcpAccess)} id="add-mcp" />
                    <span className="grid"><b>AI (MCP) access</b><span className="s">Lets this Admin connect an AI assistant to the band&apos;s data and see Roadie. Admins only.</span></span>
                  </label>
                )}
                <FieldError id="add-mcp" field="mcpAccess" error={errs.mcpAccess} />
              </fieldset>
            </>
          )}
        </div>
        <FieldError id="add-kind" field="kind" error={errs.kind} />
      </fieldset>

      <DraftNote restoredAt={d.restoredAt} status={d.status} onStartOver={() => { void d.clear({ reset: true }); setLocal({}); reset(); }} />
      <div className="flex items-center gap-3">
        <button className="btn acc" disabled={busy} data-testid="user-add">Add person</button>
        <button type="button" className="btn text" onClick={() => void cancel()} data-testid="user-cancel">Cancel</button>
      </div>
    </form>
  );
}
