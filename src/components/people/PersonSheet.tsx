"use client";
import { useState } from "react";
import { OptionalEmail, PEOPLE_MESSAGES, parseInstruments, validatePerson } from "@/schema";
import { Sheet } from "@/components/Sheet";
import { ErrorBox } from "@/components/ui";
import { Chips, FieldError, Icons, TextField, firstName, guards, useAct, type Person } from "./shared";

export type Removal = "removeTeam" | "removeBand" | "archive";

/** Edit a person in a side sheet with an explicit Save, plus the access and status actions (each opens a confirm dialog on the page). */
export function PersonSheet({ person: p, all, onClose, onRemoval }: { person: Person; all: Person[]; onClose(): void; onRemoval(kind: Removal): void }) {
  const { act, busy, error, fields, reset } = useAct();
  const [local, setLocal] = useState<Record<string, string>>({});
  const [f, setF] = useState({
    name: p.name, email: p.u ? p.u.email : p.m?.email ?? "", phone: p.m?.phone ?? "", payHandle: p.m?.payHandle ?? "",
    instruments: p.m && p.band ? p.m.instruments.join(", ") : "", role: p.role || "member", mcp: p.mcp,
  });
  const errs = { ...fields, ...local };
  const set = (patch: Partial<typeof f>, clear: string[] = []) => { setF((x) => ({ ...x, ...patch })); setLocal((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !clear.includes(k)))); };
  const team = !!p.role;
  const g = guards(p, all);
  const demoteLocked = team && p.role === "admin" && !!g.demote;
  const first = firstName(p.name);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    reset();
    const v = validatePerson({ name: f.name, bandMember: p.band, team, instruments: f.instruments, email: f.email, role: team ? f.role : "", mcpAccess: f.mcp });
    const errors: Record<string, string> = v.errors ? { ...v.errors } : {};
    if (!team && !OptionalEmail.safeParse(f.email).success) errors.email = PEOPLE_MESSAGES.email;
    if (Object.keys(errors).length) { setLocal(errors); return; }
    setLocal({});
    const name = f.name.trim();
    if (p.u) {
      const patch: Record<string, unknown> = {};
      if (name !== p.u.name) patch.name = name;
      if (f.role !== p.role) { patch.role = f.role; if (f.role === "admin" && f.mcp !== p.mcp) patch.mcpAccess = f.mcp; }
      else if (f.mcp !== p.mcp) patch.mcpAccess = f.mcp;
      if (Object.keys(patch).length && !(await act("users.update", { id: p.u.id, patch }))) return;
    }
    if (p.m && p.band) {
      const patch: Record<string, unknown> = {};
      if (name !== p.m.name) patch.name = name;
      const list = parseInstruments(f.instruments);
      if (list.join("\n") !== p.m.instruments.join("\n")) patch.instruments = list;
      const nul = (s: string) => s.trim() || null;
      if (!p.u && (nul(f.email)?.toLowerCase() ?? null) !== (p.m.email ?? null)) patch.email = nul(f.email)?.toLowerCase() ?? null;
      if (nul(f.phone) !== (p.m.phone ?? null)) patch.phone = nul(f.phone);
      if (nul(f.payHandle) !== (p.m.payHandle ?? null)) patch.payHandle = nul(f.payHandle);
      if (Object.keys(patch).length && !(await act("musicians.update", { id: p.m.id, patch }))) return;
    }
    onClose();
  }

  const row = (title: string, text: string, btn: React.ReactNode, why: string | null, testid: string) => (
    <div className="act-row" data-testid={`${testid}-row`}>
      <div className="grid min-w-0 gap-0.5">
        <b>{title}</b>
        <span className="s">{text}</span>
        {why && <span className="s" style={{ color: "var(--danger)" }} data-testid={`${testid}-why`}>{why}</span>}
      </div>
      {btn}
    </div>
  );

  return (
    <Sheet open onClose={onClose} title={`Edit ${p.name}`} testid="person-sheet" header={
      <div className="grid gap-1.5">
        <h2 className="text-xl" data-testid="person-sheet-title">{p.name}</h2>
        <div className="flex flex-wrap gap-1.5"><Chips p={p} /></div>
      </div>
    }>
      <form onSubmit={save} noValidate className="grid gap-4">
        <ErrorBox error={error} />
        <h3 className="sec-h">Details</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField id="ps-name" label="Name" value={f.name} onChange={(v) => set({ name: v }, ["name"])} error={errs.name} field="name" testid="person-sheet-name" />
          <TextField id="ps-email" label="Email" type="email" value={f.email} onChange={(v) => set({ email: v }, ["email"])} error={errs.email} field="email" testid="person-sheet-email"
            readOnly={team} hint={team ? "Their sign-in address." : undefined} />
          {p.band && <TextField id="ps-phone" label="Phone" placeholder="Optional" value={f.phone} onChange={(v) => set({ phone: v })} error={errs.phone} field="phone" testid="person-sheet-phone" />}
          {p.band && <TextField id="ps-pay" label="Pay handle" placeholder="Optional" value={f.payHandle} onChange={(v) => set({ payHandle: v })} error={errs.payHandle} field="payHandle" testid="person-sheet-payHandle" />}
        </div>

        {p.band && (
          <section className="sec" aria-labelledby="ps-band">
            <div className="grid"><h3 id="ps-band" className="font-bold">Band Member</h3><span className="s">Plays in the band: lineups, setlists, pay.</span></div>
            <TextField id="ps-instruments" label="Instruments" value={f.instruments} onChange={(v) => set({ instruments: v }, ["instruments"])} error={errs.instruments} field="instruments" testid="person-sheet-instruments" hint="Separate with commas." />
          </section>
        )}

        {team && (
          <fieldset className="sec">
            <legend className="px-1 font-bold">Team</legend>
            <span className="s">Signs in with Google as {p.email}.</span>
            <div className="grid gap-1.5">
              <span className="lbl" id="ps-access">Access level</span>
              <div className="seg" role="radiogroup" aria-labelledby="ps-access">
                <label><input type="radio" name="ps-role" checked={f.role === "member"} disabled={demoteLocked} onChange={() => set({ role: "member", mcp: false }, ["role", "mcpAccess"])} data-testid="person-sheet-role-member" />Standard</label>
                <label><input type="radio" name="ps-role" checked={f.role === "admin"} onChange={() => set({ role: "admin" }, ["role"])} data-testid="person-sheet-role-admin" />Admin</label>
              </div>
              {demoteLocked && <span className="s" style={{ color: "var(--danger)" }} data-testid="person-sheet-role-why">{g.demote}</span>}
              <FieldError id="ps-role" field="role" error={errs.role} />
            </div>
            <label className="check">
              <input type="checkbox" id="ps-mcp" checked={f.mcp} disabled={f.role !== "admin"} onChange={(e) => set({ mcp: e.target.checked }, ["mcpAccess"])} data-testid="person-sheet-mcp" aria-describedby="ps-mcp-hint" />
              <span className="grid"><b>AI (MCP) access</b><span id="ps-mcp-hint" className="s">{f.role === "admin" ? "Lets this Admin connect an AI assistant to the band's data and see Roadie." : `${PEOPLE_MESSAGES.mcpAccess}.`}</span></span>
            </label>
            <FieldError id="ps-mcp" field="mcpAccess" error={errs.mcpAccess} />
          </fieldset>
        )}

        <div className="flex items-center gap-3">
          <button className="btn acc" disabled={busy} data-testid="person-sheet-save">Save changes</button>
          <button type="button" className="btn text" onClick={onClose} data-testid="person-sheet-cancel">Cancel</button>
        </div>
      </form>

      {(team || p.band) && (
        <section className="grid gap-0" aria-labelledby="ps-status">
          <h3 id="ps-status" className="sec-h mb-1">Access &amp; status</h3>
          {team && row("Remove Team access", p.band ? "They can't sign in anymore. Stays a Band Member." : "Can't sign in anymore. They'll be removed from People.",
            <button type="button" className="btn outline" disabled={!!g.removeTeam} onClick={() => onRemoval("removeTeam")} data-testid="person-sheet-remove-team">Remove access</button>, g.removeTeam, "person-sheet-remove-team")}
          {team && p.band && row("Remove from band", "Drops them from future lineups. Keeps Team access.",
            <button type="button" className="btn outline" disabled={!!g.removeBand} onClick={() => onRemoval("removeBand")} data-testid="person-sheet-remove-band">Remove from band</button>, g.removeBand, "person-sheet-remove-band")}
          {p.band && row(`Archive ${first}`, "Removes their access and hides them from People. Past shows and pay keep their name. You can restore them later.",
            <button type="button" className="btn outline danger" disabled={!!g.archive} onClick={() => onRemoval("archive")} data-testid="person-sheet-archive">{Icons.archive}Archive</button>, g.archive, "person-sheet-archive")}
        </section>
      )}
    </Sheet>
  );
}
