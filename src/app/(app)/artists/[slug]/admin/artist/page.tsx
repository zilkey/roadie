"use client";
import { draftPath } from "@/schema/drafts";
import { useEffect, useRef, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection } from "@/lib/firestore-hooks";
import { SaveStatus } from "@/components/SaveStatus";
import { DraftNote } from "@/components/drafts/UnfinishedCard";
import { useAutosave } from "@/lib/autosave";
import { useDraft } from "@/lib/drafts";
import { newMutationId } from "@/lib/commands";
import { useRouter } from "next/navigation";
import { useArtist } from "@/lib/artist";
import { artistPath } from "@/lib/routes";
import { artistSlug, type Artist, type Musician } from "@/schema";

type Gear = { label: string; musicianId?: string };
type Cfg = { id?: string; name: string; billingName: string; musicianIds: string[]; gear: Gear[] };
type SoundGear = { bandProvided: Gear[]; venueProvided: Gear[] };

export default function ArtistPage() { return <AdminOnly><ArtistEditor /></AdminOnly>; }

function GearEditor({ title, gear, onChange, musicians, testid }: { title: string; gear: Gear[]; onChange(g: Gear[]): void; musicians: Musician[]; testid: string }) {
  return (
    <div className="grid gap-2" data-testid={testid}>
      <span className="lbl">{title}</span>
      {gear.map((g, i) => (
        <div key={i} className="flex gap-2">
          <input className="input" value={g.label} placeholder="Gear" onChange={(e) => onChange(gear.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <select className="select !w-40" value={g.musicianId ?? ""} aria-label="Who brings it"
            onChange={(e) => onChange(gear.map((x, j) => (j === i ? { label: x.label, ...(e.target.value ? { musicianId: e.target.value } : {}) } : x)))}>
            <option value="">Anyone</option>
            {musicians.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button type="button" className="btn ghost sm" onClick={() => onChange(gear.filter((_, j) => j !== i))} aria-label="Remove gear">×</button>
        </div>
      ))}
      <button type="button" className="btn ghost sm w-fit" onClick={() => onChange([...gear, { label: "" }])}>+ Add gear</button>
    </div>
  );
}

/** Blank gear rows stay on screen while you type but are not sent (a gear item needs a label). */
const clean = (gear: Gear[]) => gear.filter((g) => g.label.trim());
const cleanCfgs = (cfgs: Cfg[]) => cfgs.map((c) => ({ ...c, gear: clean(c.gear) }));

/** The artist's URL name (/artists/{slug}). Changed on purpose with a button, not autosaved: old links stop working. */
function SlugEditor({ artist }: { artist: Artist }) {
  const router = useRouter();
  const { call, error, busy, setError } = useCommand();
  const [value, setValue] = useState(artist.slug);
  useEffect(() => { setValue(artist.slug); }, [artist.slug]);
  const check = artistSlug.safeParse(value);
  const hint = value && !check.success ? check.error.issues[0]?.message : null;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!check.success) return setError(hint ?? "Not a valid URL name");
    if (value === artist.slug) return;
    const r = await call("artists.update", { id: artist.id, patch: { slug: value } });
    // The page you're on moved with it.
    if (r) router.replace(artistPath(value, "/admin/artist"));
  }
  return (
    <form className="card" onSubmit={save} data-testid="artist-slug-form">
      <span className="lbl">Web address</span>
      <div className="flex flex-wrap items-center gap-2">
        <span className="s">/artists/</span>
        <input className="input !w-auto flex-1" value={value} onChange={(e) => { setValue(e.target.value.trim().toLowerCase()); setError(null); }}
          aria-label="Web address" aria-invalid={!!hint} data-testid="artist-slug" spellCheck={false} autoCapitalize="none" />
        <button className="btn acc sm" disabled={busy || !check.success || value === artist.slug} data-testid="artist-slug-save">Change address</button>
      </div>
      {hint ? <span className="err" data-testid="artist-slug-hint">{hint}</span> : <span className="s">Lowercase letters, numbers and hyphens. Links with the old address stop working.</span>}
      <ErrorBox error={error} />
    </form>
  );
}

function ArtistEditor() {
  const musicians = useCollection<Musician>("musicians");
  const { call, error, busy } = useCommand();
  const artist = useArtist().doc ?? undefined;
  const [name, setName] = useState("");
  const [cfgs, setCfgs] = useState<Cfg[]>([]);
  const [sound, setSound] = useState<SoundGear>({ bandProvided: [], venueProvided: [] });
  const ms = (musicians.rows ?? []).filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name));
  const resetFrom = (a: Artist) => { setName(a.name); setCfgs(a.configurations); setSound(a.soundGear); };
  const as = useAutosave({ command: "artists.update", id: artist?.id ?? "", rev: artist?.rev, title: artist?.name, onUseTheirs: () => artist && resetFrom(artist) });
  const cfgDraft = useDraft(draftPath.newIn("configurations"), { name: "", billingName: "" }, { title: (v) => `New configuration${v.name ? ` · ${v.name}` : ""}` });
  const cfgMutation = useRef(newMutationId());
  const hasDraft = cfgDraft.restoredAt !== null;
  const [adding, setAdding] = useState<boolean | null>(null);

  // Follow the live document (someone else's edit, an Undo, the ids the server gave) whenever nothing of ours is waiting to be saved.
  const liveKey = JSON.stringify(artist ? [artist.name, artist.configurations, artist.soundGear] : null);
  useEffect(() => { if (artist && !as.isBusy()) resetFrom(artist); }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!artist) return <p className="s">Loading…</p>;

  function editName(v: string) {
    setName(v);
    if (v.trim()) as.patch({ name: v }); else as.hold("Artist name is required");
  }
  function editCfgs(next: Cfg[]) {
    setCfgs(next);
    const bad = next.find((c) => !c.name.trim() || !c.billingName.trim());
    if (bad) return as.hold("each configuration needs a name and a billing name");
    as.patch({ configurations: cleanCfgs(next) });
  }
  const setCfg = (i: number, p: Partial<Cfg>) => editCfgs(cfgs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  function editSound(next: SoundGear) {
    setSound(next);
    as.patch({ soundGear: { bandProvided: clean(next.bandProvided), venueProvided: clean(next.venueProvided) } });
  }
  async function addConfig() {
    await cfgDraft.settle();
    await as.flush();
    const v = cfgDraft.value;
    const base = cleanCfgs(cfgs);
    const r = await call("artists.update", { id: artist!.id, patch: { configurations: [...base, { name: v.name.trim(), billingName: v.billingName.trim() || name, musicianIds: [], gear: [] }] } },
      { clientMutationId: cfgMutation.current, clearDraft: cfgDraft.draftId });
    if (r) { await cfgDraft.clear({ reset: true }); cfgMutation.current = newMutationId(); setAdding(false); }
  }
  const showAdd = adding ?? hasDraft;

  return (
    <div className="grid gap-4" onBlur={() => void as.flush()}>
      <PageTitle title="Artist" sub="How we play, who's in each lineup, and who brings what." />
      <ErrorBox error={error} />
      <div className="card"><span className="lbl">Artist name</span><input className="input" value={name} onChange={(e) => editName(e.target.value)} data-testid="artist-name" /></div>
      <SlugEditor artist={artist} />
      {cfgs.map((c, i) => (
        <div key={c.id ?? i} className="card" data-testid={`config-${c.id ?? i}`}>
          <div className="flex items-center justify-between"><span className="lbl">Configuration</span>
            <button type="button" className="btn ghost sm" onClick={() => editCfgs(cfgs.filter((_, j) => j !== i))}>Remove</button></div>
          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder="Name (Trio)" value={c.name} onChange={(e) => setCfg(i, { name: e.target.value })} aria-label="Configuration name" />
            <input className="input" placeholder="Billing name" value={c.billingName} onChange={(e) => setCfg(i, { billingName: e.target.value })} aria-label="Billing name" />
          </div>
          <span className="lbl">Who&apos;s usually playing</span>
          <div className="flex flex-wrap gap-2">
            {ms.map((m) => {
              const on = c.musicianIds.includes(m.id);
              return (
                <label key={m.id} className={`chip cursor-pointer !px-3 !py-1.5 !text-sm ${on ? "a" : ""}`}>
                  <input type="checkbox" className="hidden" checked={on} onChange={() => setCfg(i, { musicianIds: on ? c.musicianIds.filter((x) => x !== m.id) : [...c.musicianIds, m.id] })} />
                  {m.name}
                </label>
              );
            })}
          </div>
          <GearEditor title="Gear for this lineup" gear={c.gear} musicians={ms} onChange={(gear) => setCfg(i, { gear })} testid={`gear-${c.id ?? i}`} />
        </div>
      ))}
      {showAdd ? (
        cfgDraft.ready && (
          <form className="card" data-testid="new-config" onSubmit={(e) => { e.preventDefault(); void addConfig(); }}>
            <span className="lbl">New configuration</span>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Name (Trio)" required value={cfgDraft.value.name} onChange={(e) => cfgDraft.setValue({ ...cfgDraft.value, name: e.target.value })} aria-label="New configuration name" data-testid="new-config-name" />
              <input className="input" placeholder={`Billing name (${name})`} value={cfgDraft.value.billingName} onChange={(e) => cfgDraft.setValue({ ...cfgDraft.value, billingName: e.target.value })} aria-label="New billing name" />
            </div>
            <DraftNote restoredAt={cfgDraft.restoredAt} status={cfgDraft.status} onStartOver={() => void cfgDraft.clear({ reset: true })} />
            <div className="flex gap-2">
              <button className="btn acc" disabled={busy || !cfgDraft.value.name.trim()} data-testid="new-config-add">Add configuration</button>
              <button type="button" className="btn ghost" onClick={() => setAdding(false)}>Close</button>
            </div>
          </form>
        )
      ) : <button type="button" className="btn ghost w-fit" data-testid="add-config" onClick={() => setAdding(true)}>+ Add configuration</button>}
      <div className="card">
        <GearEditor title="Sound gear we bring (when we provide sound)" gear={sound.bandProvided} musicians={ms} onChange={(g) => editSound({ ...sound, bandProvided: g })} testid="gear-band-sound" />
        <GearEditor title="Gear for venue-provided sound (monitors, in-ears…)" gear={sound.venueProvided} musicians={ms} onChange={(g) => editSound({ ...sound, venueProvided: g })} testid="gear-venue-sound" />
      </div>
      <SaveStatus {...as.statusProps} />
    </div>
  );
}
