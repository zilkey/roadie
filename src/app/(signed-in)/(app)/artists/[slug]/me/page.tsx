"use client";
import { useEffect, useState } from "react";
import { useProfile } from "@/lib/auth";
import { useDoc, type Row } from "@/lib/firestore-hooks";
import { runCommand } from "@/lib/commands";
import type { SaveState } from "@/lib/autosave";
import { AddressAutocomplete, type Place } from "@/components/AddressAutocomplete";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { SaveStatus } from "@/components/SaveStatus";
import type { DrivingSettings, FuelGrade, GeoPoint } from "@/schema";

/** The fields me.updateDriving takes. Omitted = unchanged, null = cleared. */
type DrivingPatch = { home?: GeoPoint | null; carName?: string | null; mpg?: number | null; fuelGrade?: FuelGrade };

const GRADES: readonly (readonly [FuelGrade, string])[] = [["regular", "Regular"], ["midgrade", "Midgrade"], ["premium", "Premium"], ["diesel", "Diesel"]];
const FEG_URL = "https://www.fueleconomy.gov/feg/findacar.shtml";
const PRIVATE_NOTE = "Only you can see this. Gas expenses store miles, not your address.";

/** "Name, address" when the name is not already in the address. */
const homeLabel = (h?: GeoPoint | null) => (!h ? "" : h.name && !h.address.startsWith(h.name) ? `${h.name}, ${h.address}` : h.address);
/** A suggestion as the saved place: only the fields geoPoint takes. */
const toPoint = (p: Place): GeoPoint => ({ ...(p.name ? { name: p.name } : {}), address: p.address, lat: p.lat, lng: p.lng });
/** "" -> null (clear), a positive number, or "bad" (not a usable MPG). */
const parseMpg = (s: string): number | null | "bad" => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : "bad";
};
const gradeLabel = (g: FuelGrade) => GRADES.find(([k]) => k === g)?.[1] ?? g;

export default function MySettingsPage() {
  const { uid } = useProfile();
  // users/{uid}/private/driving: the signed-in owner may read it directly (firestore.rules). Writes go through me.updateDriving.
  const { doc, loading, error } = useDoc<DrivingSettings>(`users/${uid}/private`, "driving");
  return (
    <div className="grid gap-5">
      <PageTitle title="My settings" />
      <ErrorBox error={error ?? null} />
      {loading ? <p className="s">Loading…</p>
        : doc ? <SavedDriving key="saved" saved={doc} /> : <NewDriving key="new" />}
    </div>
  );
}

/** No settings yet: an explicit Save creates the record (never auto-created). */
function NewDriving() {
  const { call, error, busy } = useCommand();
  const [home, setHome] = useState<GeoPoint | null>(null);
  const [car, setCar] = useState("");
  const [mpg, setMpg] = useState("");
  const [grade, setGrade] = useState<FuelGrade>("regular");
  const [mpgError, setMpgError] = useState<string | null>(null);

  async function save() {
    const m = parseMpg(mpg);
    if (m === "bad") return setMpgError("Enter a number above 0");
    setMpgError(null);
    const patch: DrivingPatch = { fuelGrade: grade };
    if (home) patch.home = home;
    if (car.trim()) patch.carName = car.trim();
    if (m !== null) patch.mpg = m;
    // On success the live document appears and the page switches to the saved view.
    await call("me.updateDriving", patch);
  }

  return (
    <section className="card" data-testid="me-driving-card" aria-labelledby="driving-title">
      <div>
        <h2 id="driving-title" className="text-lg font-bold">Driving &amp; gas</h2>
        <p className="s">Used to fill in gas expenses for rehearsals and shows.</p>
      </div>

      <div className="grid gap-2 rounded-[14px] bg-accent-soft p-4">
        <p className="font-bold">Make gas expenses one tap</p>
        <p className="s">Add your home address and your car&apos;s MPG once. After that, logging gas for a rehearsal or show fills itself in.</p>
        <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
          <li className="flex items-center gap-2"><span aria-hidden className="h-[18px] w-[18px] rounded-full border-2 border-[var(--muted)]" /> Home address <span className="s">{home ? "— set" : "— not set"}</span></li>
          <li className="flex items-center gap-2"><span aria-hidden className="h-[18px] w-[18px] rounded-full border-2 border-[var(--muted)]" /> MPG <span className="s">{mpg.trim() ? "— set" : "— not set"}</span></li>
        </ul>
      </div>

      <div className="grid gap-1.5">
        <span className="lbl" id="me-home-label">Home address</span>
        <AddressAutocomplete value="" placeholder="Start typing your address…" testId="me-home" onChange={() => setHome(null)} onPick={(p) => setHome(toPoint(p))} />
        <span className="s">{PRIVATE_NOTE}</span>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="grid min-w-[240px] flex-[2_1_240px] gap-1.5">
          <label htmlFor="me-car" className="lbl">Car <span className="s font-normal">(optional)</span></label>
          <input id="me-car" className="input" value={car} placeholder="e.g. 2015 Subaru Outback" data-testid="me-car" onChange={(e) => setCar(e.target.value)} />
        </div>
        <div className="grid min-w-[120px] flex-[1_1_120px] gap-1.5">
          <label htmlFor="me-mpg" className="lbl">MPG</label>
          <input id="me-mpg" className="input" inputMode="decimal" value={mpg} placeholder="e.g. 28" data-testid="me-mpg" aria-invalid={!!mpgError}
            onChange={(e) => { setMpg(e.target.value); setMpgError(null); }} />
        </div>
        <div className="grid min-w-[160px] flex-[1_1_160px] gap-1.5">
          <label htmlFor="me-grade" className="lbl">Fuel</label>
          <select id="me-grade" className="select" value={grade} data-testid="me-grade" onChange={(e) => setGrade(e.target.value as FuelGrade)}>
            {GRADES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>
      {mpgError && <span className="err" data-testid="me-mpg-error">{mpgError}</span>}
      <a href={FEG_URL} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent" data-testid="me-mpg-lookup">Look up my car&apos;s MPG</a>

      <ErrorBox error={error} />
      <div className="flex justify-end">
        <button type="button" className="btn acc" data-testid="me-save" disabled={busy} onClick={save}>Save</button>
      </div>
    </section>
  );
}

/** Saved settings: read-only until Edit. Each field then autosaves on change or blur; Done closes the card. */
function SavedDriving({ saved }: { saved: Row<DrivingSettings> }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [car, setCar] = useState(saved.carName ?? "");
  const [mpg, setMpg] = useState(saved.mpg !== undefined ? String(saved.mpg) : "");
  const [mpgError, setMpgError] = useState<string | null>(null);

  // Follow the live document (another device, or the save that just went out).
  useEffect(() => { setCar(saved.carName ?? ""); }, [saved.carName]);
  useEffect(() => { setMpg(saved.mpg !== undefined ? String(saved.mpg) : ""); }, [saved.mpg]);

  // One field per command: me.updateDriving changes only the keys it is sent.
  async function save(patch: DrivingPatch) {
    setStatus("saving"); setError(null);
    try {
      await runCommand("me.updateDriving", patch);
      setStatus("saved");
    } catch (e) {
      setStatus(e instanceof Error && (e as { code?: string }).code === "offline" ? "offline" : "error");
      setError(e instanceof Error ? e.message : "error");
    }
  }
  async function saveCar() {
    const v = car.trim() || null;
    if (v === (saved.carName ?? null)) return;
    await save({ carName: v });
  }
  async function saveMpg() {
    const m = parseMpg(mpg);
    if (m === "bad") return setMpgError("Enter a number above 0");
    setMpgError(null);
    if (m === (saved.mpg ?? null)) return;
    await save({ mpg: m });
  }
  // A picked suggestion is saved as the home address; emptying the field clears it.
  const pickHome = (p: Place) => save({ home: toPoint(p) });
  const clearHome = (text: string) => { if (!text.trim() && saved.home) void save({ home: null }); };

  return (
    <section className={`card${editing ? " editing" : ""}`} data-testid="me-driving-card" aria-labelledby="driving-title">
      <div className="card-head">
        <div>
          <h2 id="driving-title" className="text-lg font-bold">Driving &amp; gas</h2>
          {!editing && <p className="s">Used to fill in gas expenses for rehearsals and shows.</p>}
        </div>
        {editing ? <span className="tag">Editing</span>
          : <button type="button" className="card-edit" onClick={() => { setError(null); setEditing(true); }} data-testid="me-edit">Edit</button>}
      </div>

      {editing ? (
        <div className="grid gap-4" data-testid="me-form">
          <div className="grid gap-1.5">
            <span className="lbl">Home address</span>
            <AddressAutocomplete value={homeLabel(saved.home)} placeholder="Start typing your address…" testId="me-home" onPick={pickHome} onChange={clearHome} />
            <span className="s">{PRIVATE_NOTE}</span>
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="grid min-w-[240px] flex-[2_1_240px] gap-1.5">
              <label htmlFor="me-car" className="lbl">Car <span className="s font-normal">(optional)</span></label>
              <input id="me-car" className="input" value={car} placeholder="e.g. 2015 Subaru Outback" data-testid="me-car"
                onChange={(e) => setCar(e.target.value)} onBlur={saveCar} />
            </div>
            <div className="grid min-w-[120px] flex-[1_1_120px] gap-1.5">
              <label htmlFor="me-mpg" className="lbl">MPG</label>
              <input id="me-mpg" className="input" inputMode="decimal" value={mpg} placeholder="e.g. 28" data-testid="me-mpg" aria-invalid={!!mpgError}
                onChange={(e) => { setMpg(e.target.value); setMpgError(null); }} onBlur={saveMpg} />
            </div>
            <div className="grid min-w-[160px] flex-[1_1_160px] gap-1.5">
              <label htmlFor="me-grade" className="lbl">Fuel</label>
              <select id="me-grade" className="select" value={saved.fuelGrade} data-testid="me-grade" onChange={(e) => void save({ fuelGrade: e.target.value as FuelGrade })}>
                {GRADES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>
          {mpgError && <span className="err" data-testid="me-mpg-error">{mpgError}</span>}
          <a href={FEG_URL} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent" data-testid="me-mpg-lookup">Look up my car&apos;s MPG</a>

          <ErrorBox error={error} />
          <div className="card-foot"><div className="end">
            <SaveStatus status={status} error={error} />
            <button type="button" className="btn acc" data-testid="me-done" onClick={() => setEditing(false)}>Done</button>
          </div></div>
        </div>
      ) : (
        <div className="grid gap-3" data-testid="me-values">
          <dl className="m-0 grid gap-3">
            <div className="grid gap-0.5"><dt className="lbl">Home address</dt><dd className="m-0" data-testid="me-home-value">{homeLabel(saved.home) || "Not set"}</dd></div>
            <div className="grid gap-0.5"><dt className="lbl">Car</dt><dd className="m-0" data-testid="me-car-value">{saved.carName || "Not set"}</dd></div>
            <div className="grid gap-0.5"><dt className="lbl">MPG</dt><dd className="m-0" data-testid="me-mpg-value">{saved.mpg !== undefined ? String(saved.mpg) : "Not set"}</dd></div>
            <div className="grid gap-0.5"><dt className="lbl">Fuel</dt><dd className="m-0" data-testid="me-grade-value">{gradeLabel(saved.fuelGrade)}</dd></div>
          </dl>
          <span className="s">{PRIVATE_NOTE}</span>
        </div>
      )}
    </section>
  );
}
