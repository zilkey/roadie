"use client";
import { draftPath } from "@/schema/drafts";
import { useEffect, useRef, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, PickChip, useCommand } from "@/components/ui";
import { Icons } from "@/components/people/shared";
import { useCollection } from "@/lib/firestore-hooks";
import { SaveStatus } from "@/components/SaveStatus";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useAutosave } from "@/lib/autosave";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useArtist } from "@/lib/artist";
import type { Artist, Musician } from "@/schema";

type Cfg = { id?: string; name: string; billingName: string; musicianIds: string[] };

export default function LineupsPage() { return <AdminOnly><LineupsEditor /></AdminOnly>; }

/** Band Configurations: the lineups shows are booked under. Autosaved on its own, apart from the General page's links. */
function LineupsEditor() {
  const musicians = useCollection<Musician>("musicians");
  const { call, error, busy } = useCommand();
  const artist = useArtist().doc ?? undefined;
  const [cfgs, setCfgs] = useState<Cfg[]>([]);
  const ms = (musicians.rows ?? []).filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name));
  const resetFrom = (a: Artist) => setCfgs(a.configurations);
  const as = useAutosave({ command: "artists.update", id: artist?.id ?? "", rev: artist?.rev, scope: "lineups", title: artist?.name, onUseTheirs: () => artist && resetFrom(artist) });
  const cfgDraft = useDraft(draftPath.newIn("configurations"), { name: "", billingName: "", musicianIds: [] as string[] }, { title: (v) => `New configuration${v.name ? ` · ${v.name}` : ""}` });
  const cfgMutation = useRef(newMutationId());
  const hasDraft = cfgDraft.restoredAt !== null;
  const [form, setForm] = useState<{ kind: "new" } | { kind: "edit"; key: string } | null | undefined>(undefined);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  // Follow the live document (someone else's edit, an Undo, the ids the server gave) whenever nothing of ours is waiting to be saved.
  const liveKey = JSON.stringify(artist ? artist.configurations : null);
  useEffect(() => { if (artist && !as.isBusy()) resetFrom(artist); }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!artist) return <p className="s">Loading…</p>;
  const name = artist.name;

  function editCfgs(next: Cfg[]) {
    setCfgs(next);
    const bad = next.find((c) => !c.name.trim() || !c.billingName.trim());
    if (bad) return as.hold("each configuration needs a name and a billing name");
    as.patch({ configurations: next });
  }
  const setCfg = (i: number, p: Partial<Cfg>) => editCfgs(cfgs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  async function addConfig() {
    await cfgDraft.settle();
    await as.flush();
    const v = cfgDraft.value;
    const r = await call("artists.update", { id: artist!.id, patch: { configurations: [...cfgs, { name: v.name.trim(), billingName: v.billingName.trim() || name, musicianIds: v.musicianIds ?? [] }] } },
      { clientMutationId: cfgMutation.current, clearDraft: cfgDraft.draftId });
    if (r) { await cfgDraft.clear({ reset: true }); cfgMutation.current = newMutationId(); setForm(null); }
  }
  const keyOf = (c: Cfg, i: number) => c.id ?? String(i);
  const cur = form === undefined ? (hasDraft ? { kind: "new" as const } : null) : form;
  const editI = cur?.kind === "edit" ? cfgs.findIndex((c, i) => keyOf(c, i) === cur.key) : -1;
  const open = cur?.kind === "new" || editI >= 0;
  const editC = editI >= 0 ? cfgs[editI] : null;
  const allMs = musicians.rows ?? [];
  const toggle = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const dv = cfgDraft.value;
  const fields = (p: string, v: { name: string; billingName: string }, set: (x: { name?: string; billingName?: string }) => void) => (
    <div className="cfg-fields">
      <div><label htmlFor={`${p}-name`}>Name</label><input id={`${p}-name`} className="input" placeholder="e.g. Quartet" value={v.name} onChange={(e) => set({ name: e.target.value })} data-testid={`${p}-name`} /></div>
      <div><label htmlFor={`${p}-billing`}>Billed as</label><input id={`${p}-billing`} className="input" placeholder={name} value={v.billingName} onChange={(e) => set({ billingName: e.target.value })} data-testid={`${p}-billing`} /></div>
    </div>
  );
  const members = (ids: string[], set: (ids: string[]) => void) => (
    <fieldset><legend>Who&apos;s usually playing</legend>
      <div className="cfg-members">{ms.map((m) => <PickChip key={m.id} on={ids.includes(m.id)} onToggle={() => set(toggle(ids, m.id))} testid={`config-member-${m.id}`}>{m.name}</PickChip>)}</div>
    </fieldset>
  );
  function done() {
    if (!editC) return;
    if (!editC.billingName.trim()) setCfg(editI, { billingName: name });
    setForm(null);
  }

  return (
    <div className="grid gap-5" onBlur={() => void as.flush()}>
      <PageTitle title="Lineups" sub="The band configurations you book under. Each show uses one." actions={<SaveStatus {...as.statusProps} />} />
      <ErrorBox error={error} />
      <section className="card" data-testid="configs" aria-labelledby="cfg-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="cfg-title" className="text-lg font-bold">Band Configurations</h2>
          {!open && <button type="button" className="btn ghost" data-testid="add-config" onClick={() => setForm({ kind: "new" })}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg> New configuration</button>}
        </div>
        {cur?.kind === "new" && cfgDraft.ready && (
          <form className="cfg-form" data-testid="new-config" onSubmit={(e) => { e.preventDefault(); void addConfig(); }}>
            <h3>New configuration</h3>
            {fields("new-config", dv, (x) => cfgDraft.setValue({ ...dv, ...x }))}
            {members(dv.musicianIds ?? [], (ids) => cfgDraft.setValue({ ...dv, musicianIds: ids }))}
            <DraftNote restoredAt={cfgDraft.restoredAt} status={cfgDraft.status} onStartOver={() => void cfgDraft.clear({ reset: true })} />
            <div className="cfg-actions">
              <button type="button" className="btn text" data-testid="new-config-cancel" onClick={() => { void cfgDraft.clear({ reset: true }); setForm(null); }}>Cancel</button>
              <button className="btn acc" disabled={busy || !dv.name.trim()} data-testid="new-config-add">Add configuration</button>
            </div>
          </form>
        )}
        {editC && (
          <form className="cfg-form" data-testid="edit-config" onSubmit={(e) => { e.preventDefault(); if (editC.name.trim()) done(); }}>
            <h3>Edit {editC.name}</h3>
            {fields("edit-config", editC, (x) => setCfg(editI, x))}
            {members(editC.musicianIds, (ids) => setCfg(editI, { musicianIds: ids }))}
            <div className="cfg-actions"><button className="btn acc" disabled={!editC.name.trim()} data-testid="edit-config-done">Done</button></div>
          </form>
        )}
        {cfgs.length === 0 ? <p className="s text-center" data-testid="configs-empty">No configurations yet. Add one to start booking shows.</p> : (
          <div className="cfg-scroll"><table className="cfg-table">
            <thead><tr><th>Name</th><th>Billed as</th><th>Who&apos;s usually playing</th><th className="act"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{cfgs.map((c, i) => {
              const key = keyOf(c, i), isEditing = editI === i;
              const found = c.musicianIds.map((id) => allMs.find((m) => m.id === id)).filter((m): m is Musician => !!m);
              return (
                <tr key={key} data-testid={`config-${key}`} data-editing={isEditing ? "1" : undefined}>
                  <td className="nm">{c.name}</td>
                  <td>{c.billingName}</td>
                  <td className="mem">{found.length ? found.map((m) => <span key={m.id} className="chip a">{m.name}</span>) : <span className="s">No one yet</span>}</td>
                  <td className="act">{confirmKey === key ? (
                    <><span>Remove {c.name}?</span>
                      <button type="button" className="btn danger sm" data-testid={`config-remove-yes-${key}`} onClick={() => { editCfgs(cfgs.filter((_, j) => j !== i)); setConfirmKey(null); if (isEditing) setForm(null); }}>Remove</button>{" "}
                      <button type="button" className="btn text sm" data-testid={`config-remove-keep-${key}`} onClick={() => setConfirmKey(null)}>Keep</button></>
                  ) : (
                    <><button type="button" className="icon-btn" aria-label={`Edit ${c.name}`} data-testid={`config-edit-${key}`} onClick={() => { setConfirmKey(null); setForm({ kind: "edit", key }); }}>{Icons.edit}</button>
                      <button type="button" className="icon-btn danger" aria-label={`Remove ${c.name}`} data-testid={`config-remove-${key}`} onClick={() => setConfirmKey(key)}>{Icons.trash}</button></>
                  )}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
