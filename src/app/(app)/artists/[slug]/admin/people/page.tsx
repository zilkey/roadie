"use client";
import { useMemo, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { Tabs } from "@/components/booking/common";
import { Menu, type MenuItem } from "@/components/Menu";
import { Dialog, ErrorBox } from "@/components/ui";
import { AddPerson } from "@/components/people/AddPerson";
import { PersonSheet, type Removal } from "@/components/people/PersonSheet";
import { FieldError, Icons, TextField, derivePeople, firstName, guards, invalid, useAct, type Person } from "@/components/people/shared";
import { useCollection } from "@/lib/firestore-hooks";
import { useProfile } from "@/lib/auth";
import { useArtist } from "@/lib/artist";
import { PEOPLE_MESSAGES, TeamEmail, parseInstruments, type Musician, type User } from "@/schema";

export default function PeoplePage() { return <AdminOnly><People /></AdminOnly>; }

type Tab = "all" | "band" | "team" | "archived";
type Modal = { kind: Removal | "giveTeam" | "addBand"; p: Person; from: "menu" | "sheet" };

function People() {
  const me = useProfile();
  const { artistId } = useArtist();
  const users = useCollection<User>("users");
  const musicians = useCollection<Musician>("musicians");
  const [tab, setTab] = useState<Tab>("all");
  const [adding, setAdding] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const act = useAct();

  const all = useMemo(() => derivePeople(users.rows ?? [], musicians.rows ?? [], artistId, me.uid), [users.rows, musicians.rows, artistId, me.uid]);
  const live = all.filter((p) => !p.archived);
  const archived = all.filter((p) => p.archived);
  const counts = { all: live.length, band: live.filter((p) => p.band).length, team: live.filter((p) => p.role).length, archived: archived.length };
  const shown = tab === "archived" ? archived : tab === "band" ? live.filter((p) => p.band) : tab === "team" ? live.filter((p) => p.role) : live;
  const editing = editKey ? all.find((p) => p.id === editKey && !p.archived) ?? null : null;
  const loading = users.rows === null || musicians.rows === null;

  function menuFor(p: Person): MenuItem[] {
    if (p.archived) return [{ key: "restore", label: "Restore", icon: Icons.restore, onSelect: () => void restore(p) }];
    const g = guards(p, all);
    const items: MenuItem[] = [{ key: "edit", label: "Edit", icon: Icons.edit, onSelect: () => setEditKey(p.id) }];
    let first = true;
    const mid = (it: MenuItem) => { items.push(first ? { ...it, divider: true } : it); first = false; };
    if (p.band && !p.role) mid({ key: "give-team", label: "Give Team access", icon: Icons.key, onSelect: () => setModal({ kind: "giveTeam", p, from: "menu" }) });
    if (p.role && !p.band) mid({ key: "add-to-band", label: "Add to band", icon: Icons.band, onSelect: () => setModal({ kind: "addBand", p, from: "menu" }) });
    if (p.role) mid({ key: "remove-team", label: "Remove Team access", icon: Icons.signOut, disabled: !!g.removeTeam, hint: g.removeTeam ?? undefined, onSelect: () => setModal({ kind: "removeTeam", p, from: "menu" }) });
    if (p.band && p.role) mid({ key: "remove-band", label: "Remove from band", icon: Icons.minus, disabled: !!g.removeBand, hint: g.removeBand ?? undefined, onSelect: () => setModal({ kind: "removeBand", p, from: "menu" }) });
    if (p.band) items.push({ key: "archive", label: "Archive", icon: Icons.archive, danger: true, divider: true, disabled: !!g.archive, hint: g.archive ?? undefined, onSelect: () => setModal({ kind: "archive", p, from: "menu" }) });
    return items;
  }

  async function restore(p: Person) {
    if (p.m) await act.act("musicians.restore", { id: p.m.id });
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <h1 className="text-2xl" data-testid="page-title">People</h1>
          <p className="s"><b>Band Members</b> play in the band. The <b>Team</b> can sign in to Roadie.</p>
        </div>
        <button type="button" className="btn acc" onClick={() => setAdding(true)} data-testid="people-add-open">+ Add a person</button>
      </div>

      {adding && <AddPerson onClose={() => setAdding(false)} />}
      <ErrorBox error={act.error} />

      <Tabs<Tab> testid="people-tab" value={tab} onChange={setTab} options={[
        ["all", `All · ${counts.all}`], ["band", `Band Members · ${counts.band}`], ["team", `Team · ${counts.team}`],
        ["archived", <span key="a" style={{ opacity: 0.75 }}>{`Archived · ${counts.archived}`}</span>],
      ]} />

      <div className="card flush">
        <table className="people-table" data-testid="user-list">
          <thead><tr><th>Name</th><th>Email</th><th>Instruments</th><th>Team access</th><th className="act"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} data-testid={`person-row-${p.key}`}>
                <td><b>{p.name}</b>{p.me && <span className="s"> (you)</span>}</td>
                <td className="em s">{p.email}</td>
                <td>{p.m && p.band ? p.m.instruments.join(", ") : p.archived && p.m ? <span className="s">{p.m.instruments.join(", ")}</span> : <span className="s">— not in band</span>}</td>
                <td>
                  {p.role ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span className={`chip ${p.role === "admin" ? "dk" : "m"}`}>{p.role === "admin" ? "Admin" : "Standard"}</span>
                      {p.mcp && <span className="chip a">AI</span>}
                    </span>
                  ) : <span className="s">— no sign-in</span>}
                </td>
                <td className="act"><Menu testid="person" label={`Actions for ${p.name}`} items={menuFor(p)} /></td>
              </tr>
            ))}
            {!loading && shown.length === 0 && <tr><td colSpan={5}><span className="s">Nobody here.</span></td></tr>}
          </tbody>
        </table>
      </div>

      {archived.length > 0 && tab !== "archived" && (
        <p className="s flex flex-wrap items-center gap-2" data-testid="people-archived-note">
          {Icons.archive}
          <span>{archived.length} archived {archived.length === 1 ? "person is" : "people are"} hidden. Past shows and pay still list them.</span>
          <button type="button" className="link" onClick={() => setTab("archived")} data-testid="people-show-archived">Show archived</button>
        </p>
      )}

      {editing && <PersonSheet key={editing.id} person={editing} all={all} onClose={() => setEditKey(null)} onRemoval={(kind) => setModal({ kind, p: editing, from: "sheet" })} />}

      {modal && <PersonDialog modal={modal} onClose={() => setModal(null)} onDone={() => { if (modal.from === "sheet" || modal.kind === "archive" || modal.kind === "removeTeam") setEditKey(null); setModal(null); }} />}
    </div>
  );
}

function PersonDialog({ modal, onClose, onDone }: { modal: Modal; onClose(): void; onDone(): void }) {
  const { kind, p } = modal;
  if (kind === "giveTeam") return <GiveTeam p={p} onClose={onClose} onDone={onDone} />;
  if (kind === "addBand") return <AddToBand p={p} onClose={onClose} onDone={onDone} />;
  return <Confirm kind={kind} p={p} onClose={onClose} onDone={onDone} />;
}

function Confirm({ kind, p, onClose, onDone }: { kind: Removal; p: Person; onClose(): void; onDone(): void }) {
  const { act, busy, error } = useAct();
  const text = {
    removeTeam: { title: `Remove Team access for ${p.name}?`, ok: "Remove access", body: p.band ? `${p.name} can't sign in anymore. They stay a Band Member.` : `${p.name} can't sign in anymore. They'll be removed from People.` },
    removeBand: { title: `Remove ${p.name} from the band?`, ok: "Remove from band", body: `${p.name} will be dropped from future lineups. They keep Team access.` },
    archive: { title: `Archive ${p.name}?`, ok: "Archive", body: `${firstName(p.name)} loses their access and is hidden from People. Past shows and pay keep their name. You can restore them later.` },
  }[kind];
  async function go() {
    const r = kind === "removeTeam" ? await act("users.remove", { id: p.u!.id })
      : kind === "removeBand" ? await act("musicians.removeFromBand", { id: p.m!.id })
      : await act("musicians.archive", { id: p.m!.id });
    if (r) onDone();
  }
  return (
    <Dialog open onClose={onClose} title={text.title} testid="confirm-dialog">
      <p>{text.body}</p>
      {error && <div className="err" role="alert" data-testid="confirm-error">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn text" onClick={onClose} data-testid="confirm-cancel">Cancel</button>
        <button type="button" className={`btn ${kind === "archive" ? "danger" : ""}`} disabled={busy} onClick={() => void go()} data-testid="confirm-ok">{text.ok}</button>
      </div>
    </Dialog>
  );
}

function GiveTeam({ p, onClose, onDone }: { p: Person; onClose(): void; onDone(): void }) {
  const { act, busy, error, fields } = useAct();
  const [f, setF] = useState({ email: p.email, role: "member", mcp: false });
  const [local, setLocal] = useState<Record<string, string>>({});
  const errs = { ...fields, ...local };
  async function go(e: React.FormEvent) {
    e.preventDefault();
    const bad: Record<string, string> = {};
    if (!TeamEmail.safeParse(f.email).success) bad.email = PEOPLE_MESSAGES.email;
    setLocal(bad);
    if (Object.keys(bad).length) return;
    const r = await act("users.add", { email: f.email, name: p.name, role: f.role, mcpAccess: f.role === "admin" && f.mcp, musicianId: p.m!.id });
    if (r) onDone();
  }
  return (
    <Dialog open onClose={onClose} title={`Give ${p.name} Team access`} testid="give-team-dialog">
      <form onSubmit={go} noValidate className="grid gap-3">
        <TextField id="gt-email" label="Email" type="email" value={f.email} onChange={(v) => { setF({ ...f, email: v }); setLocal({}); }} error={errs.email} field="email" testid="give-email" hint="They sign in with this address. Nothing is emailed." />
        <fieldset className="grid gap-2 border-0 p-0 m-0 min-w-0">
          <legend className="lbl p-0 mb-1">Access level</legend>
          <label className="opt"><input type="radio" name="gt-role" checked={f.role === "member"} onChange={() => setF({ ...f, role: "member", mcp: false })} data-testid="give-role-member" /><span className="grid"><b>Standard</b><span className="s">Can see their earnings and expenses and shows, but can&apos;t book or see other finances</span></span></label>
          <label className="opt"><input type="radio" name="gt-role" checked={f.role === "admin"} onChange={() => setF({ ...f, role: "admin" })} data-testid="give-role-admin" /><span className="grid"><b>Admin</b><span className="s">Everything, including people, money and band settings.</span></span></label>
          {f.role === "admin" && (
            <label className="check ml-7"><input type="checkbox" id="gt-mcp" checked={f.mcp} onChange={(e) => setF({ ...f, mcp: e.target.checked })} data-testid="give-mcp" {...invalid("gt-mcp", errs.mcpAccess)} /><span className="grid"><b>AI (MCP) access</b><span className="s">Lets this Admin connect an AI assistant to the band&apos;s data and see Roadie. Admins only.</span></span></label>
          )}
          <FieldError id="gt-mcp" field="mcpAccess" error={errs.mcpAccess} />
        </fieldset>
        {error && <div className="err" role="alert" data-testid="confirm-error">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn text" onClick={onClose} data-testid="give-cancel">Cancel</button>
          <button className="btn acc" disabled={busy} data-testid="give-submit">Give Team access</button>
        </div>
      </form>
    </Dialog>
  );
}

function AddToBand({ p, onClose, onDone }: { p: Person; onClose(): void; onDone(): void }) {
  const { act, busy, error, fields } = useAct();
  const [text, setText] = useState("");
  const [local, setLocal] = useState<string>();
  const err = fields.instruments ?? local;
  async function go(e: React.FormEvent) {
    e.preventDefault();
    const list = parseInstruments(text);
    if (!list.length) return setLocal(PEOPLE_MESSAGES.instruments);
    const r = await act("users.addToBand", { id: p.u!.id, instruments: list });
    if (r) onDone();
  }
  return (
    <Dialog open onClose={onClose} title={`Add ${p.name} to the band`} testid="add-band-dialog">
      <form onSubmit={go} noValidate className="grid gap-3">
        <TextField id="ab-instruments" label="Instruments · required" value={text} onChange={(v) => { setText(v); setLocal(undefined); }} error={err} field="instruments" testid="band-instruments" hint="Separate with commas." />
        {error && <div className="err" role="alert" data-testid="confirm-error">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn text" onClick={onClose} data-testid="band-cancel">Cancel</button>
          <button className="btn acc" disabled={busy} data-testid="band-submit">Add to band</button>
        </div>
      </form>
    </Dialog>
  );
}
