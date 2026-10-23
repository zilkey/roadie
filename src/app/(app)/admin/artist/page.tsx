"use client";
import { useEffect, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useCollection } from "@/lib/firestore-hooks";
import type { Artist, Musician } from "@/schema";

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

function ArtistEditor() {
  const artists = useCollection<Artist>("artists");
  const musicians = useCollection<Musician>("musicians");
  const { call, error, busy } = useCommand();
  const artist = artists.rows?.[0];
  const [name, setName] = useState("");
  const [cfgs, setCfgs] = useState<Cfg[]>([]);
  const [sound, setSound] = useState<SoundGear>({ bandProvided: [], venueProvided: [] });
  const [saved, setSaved] = useState(false);
  const ms = (musicians.rows ?? []).filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    if (!artist) return;
    setName(artist.name); setCfgs(artist.configurations); setSound(artist.soundGear);
  }, [artist]);

  if (artists.loading) return <p className="s">Loading…</p>;
  if (!artist) {
    return (
      <div className="grid gap-4">
        <PageTitle title="Artist & gear" />
        <ErrorBox error={error} />
        <div className="card">
          <span className="s">No artist yet.</span>
          <button className="btn acc w-fit" disabled={busy} data-testid="artist-create"
            onClick={() => call("artists.create", { name: "Ingrid Avison Band", configurations: [{ name: "Full band", billingName: "Ingrid Avison Band", musicianIds: [], gear: [] }] })}>
            Create Ingrid Avison Band
          </button>
        </div>
      </div>
    );
  }

  const setCfg = (i: number, p: Partial<Cfg>) => setCfgs(cfgs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  async function save() {
    const r = await call("artists.update", { id: artist!.id, patch: { name, configurations: cfgs, soundGear: sound } });
    setSaved(!!r);
  }

  return (
    <div className="grid gap-4">
      <PageTitle title="Artist & gear" sub="How we play, who's in each lineup, and who brings what." />
      <ErrorBox error={error} />
      <div className="card"><span className="lbl">Artist name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="artist-name" /></div>
      {cfgs.map((c, i) => (
        <div key={c.id ?? i} className="card" data-testid={`config-${c.id ?? i}`}>
          <div className="flex items-center justify-between"><span className="lbl">Configuration</span>
            <button type="button" className="btn ghost sm" onClick={() => setCfgs(cfgs.filter((_, j) => j !== i))}>Remove</button></div>
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
      <button type="button" className="btn ghost w-fit" data-testid="add-config" onClick={() => setCfgs([...cfgs, { name: "", billingName: name, musicianIds: [], gear: [] }])}>+ Add configuration</button>
      <div className="card">
        <GearEditor title="Sound gear we bring (when we provide sound)" gear={sound.bandProvided} musicians={ms} onChange={(g) => setSound({ ...sound, bandProvided: g })} testid="gear-band-sound" />
        <GearEditor title="Gear for venue-provided sound (monitors, in-ears…)" gear={sound.venueProvided} musicians={ms} onChange={(g) => setSound({ ...sound, venueProvided: g })} testid="gear-venue-sound" />
      </div>
      <button className="btn acc" disabled={busy} onClick={save} data-testid="artist-save">Save</button>
      {saved && <span className="s" data-testid="artist-saved">Saved.</span>}
    </div>
  );
}
