"use client";
import { AddressAutocomplete, type Place } from "@/components/AddressAutocomplete";
import type { Car, DrivingSettings, FuelGrade, GeoPoint } from "@/schema";

/** What me.updateDriving / people.updateDriving take. Omitted = unchanged; home null = cleared; cars = the whole list. */
export type CarIn = { id?: string; name: string; mpg?: number | null; fuelGrade: FuelGrade };
export type DrivingPatch = { home?: GeoPoint | null; cars?: CarIn[] };

export const GRADES: readonly (readonly [FuelGrade, string])[] = [["regular", "Regular"], ["midgrade", "Midgrade"], ["premium", "Premium"], ["diesel", "Diesel"]];
export const FEG_URL = "https://www.fueleconomy.gov/feg/findacar.shtml";
export const gradeLabel = (g: FuelGrade) => GRADES.find(([k]) => k === g)?.[1] ?? g;

/** "Name, address" when the name is not already in the address. */
export const homeLabel = (h?: GeoPoint | null) => (!h ? "" : h.name && !h.address.startsWith(h.name) ? `${h.name}, ${h.address}` : h.address);
/** A suggestion as the saved place: only the fields geoPoint takes. */
export const toPoint = (p: Place): GeoPoint => ({ ...(p.name ? { name: p.name } : {}), address: p.address, lat: p.lat, lng: p.lng });
/** "" -> null (none), a positive number, or "bad" (not a usable MPG). */
export const parseMpg = (s: string): number | null | "bad" => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : "bad";
};
/** "Subaru Outback · 28 MPG · Regular" */
export const carLine = (c: Car) => [c.name, c.mpg !== undefined ? `${c.mpg} MPG` : "MPG not set", gradeLabel(c.fuelGrade)].join(" · ");

/** One car row as typed. `key` is the saved id, or a local one for a car not saved yet. */
export interface CarDraft { key: string; id?: string; name: string; mpg: string; fuelGrade: FuelGrade }
let seq = 0;
export const newCarDraft = (): CarDraft => ({ key: `new-${++seq}`, name: "", mpg: "", fuelGrade: "regular" });
export const toDrafts = (cars?: Car[]): CarDraft[] =>
  (cars ?? []).map((c) => ({ key: c.id, id: c.id, name: c.name, mpg: c.mpg !== undefined ? String(c.mpg) : "", fuelGrade: c.fuelGrade }));

/**
 * Follow the saved list without disturbing typing: a row keeps its key and what is typed in it, and a row saved for the
 * first time takes its new id (so its inputs are not remounted and focus stays put). Cars saved elsewhere are added,
 * cars removed elsewhere drop out, and empty unsaved rows stay at the end.
 */
export function mergeSaved(rows: CarDraft[], saved?: Car[]): CarDraft[] {
  const pending = rows.filter((r) => !r.id && (r.name.trim() || r.mpg.trim()));
  const out = (saved ?? []).map((c): CarDraft => {
    const mine = rows.find((r) => r.id === c.id) ?? pending.shift();
    return mine ? { ...mine, id: c.id } : toDrafts([c])[0];
  });
  return [...out, ...rows.filter((r) => !r.id && !r.name.trim() && !r.mpg.trim())];
}

/**
 * The typed rows as the command's cars list. A row with no name and no MPG is skipped (an empty "Add car" row);
 * errors are keyed by row and field ("name" | "mpg").
 */
export function draftsToCars(rows: CarDraft[]): { cars: CarIn[]; errors: Record<string, string> } {
  const cars: CarIn[] = [], errors: Record<string, string> = {};
  for (const r of rows) {
    if (!r.name.trim() && !r.mpg.trim()) continue;
    const m = parseMpg(r.mpg);
    if (!r.name.trim()) errors[`${r.key}.name`] = "Name the car";
    if (m === "bad") errors[`${r.key}.mpg`] = "Enter a number above 0";
    cars.push({ ...(r.id ? { id: r.id } : {}), name: r.name.trim(), mpg: m === "bad" ? null : m, fuelGrade: r.fuelGrade });
  }
  return { cars, errors };
}

/** Whether a cars list differs from what is saved (order, names, MPG, fuel; a new car always does). */
export function carsChanged(saved: Car[] | undefined, cars: CarIn[]): boolean {
  const s = saved ?? [];
  if (s.length !== cars.length) return true;
  return cars.some((c, i) => c.id !== s[i].id || c.name !== s[i].name || (c.mpg ?? undefined) !== s[i].mpg || c.fuelGrade !== s[i].fuelGrade);
}

/** The saved settings as read text: home, then one line per car. */
export function DrivingValues({ saved, testid }: { saved?: DrivingSettings; testid: string }) {
  const cars = saved?.cars ?? [];
  return (
    <dl className="m-0 grid gap-3" data-testid={`${testid}-values`}>
      <div className="grid gap-0.5"><dt className="lbl">Home address</dt><dd className="m-0" data-testid={`${testid}-home-value`}>{homeLabel(saved?.home) || "Not set"}</dd></div>
      <div className="grid gap-0.5"><dt className="lbl">{cars.length > 1 ? "Cars" : "Car"}</dt>
        <dd className="m-0" data-testid={`${testid}-cars-value`}>
          {cars.length ? <ul className="m-0 grid list-none gap-0.5 p-0">{cars.map((c, i) => <li key={c.id} data-testid={`${testid}-car-value-${i}`}>{carLine(c)}</li>)}</ul> : "Not set"}
        </dd>
      </div>
    </dl>
  );
}

/**
 * Home address and the cars list, as fields. Controlled: the caller keeps the rows and decides when to save
 * (People's sheet on Save; My settings on each change via onCommit, called after a pick, a blur, a fuel change or a removal).
 */
export function DrivingFields({ testid, homeText, onPickHome, onHomeText, rows, setRows, errors, onCommit, homeHint }: {
  testid: string;
  /** The address field's text (the saved home's label to start). */
  homeText: string;
  onPickHome(p: GeoPoint): void;
  /** Typing in the address field; "" means clear the home. */
  onHomeText(text: string): void;
  rows: CarDraft[];
  setRows(next: CarDraft[]): void;
  errors: Record<string, string>;
  /** Save now (autosave pages): called with the rows as they are after the change. */
  onCommit?(rows: CarDraft[]): void;
  homeHint?: string;
}) {
  const edit = (key: string, patch: Partial<CarDraft>, commit = false) => {
    const next = rows.map((r) => (r.key === key ? { ...r, ...patch } : r));
    setRows(next);
    if (commit) onCommit?.(next);
  };
  const remove = (key: string) => { const next = rows.filter((r) => r.key !== key); setRows(next); onCommit?.(next); };
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <span className="lbl">Home address</span>
        <AddressAutocomplete value={homeText} placeholder="Start typing an address…" testId={`${testid}-home`} onPick={(p) => onPickHome(toPoint(p))} onChange={onHomeText} />
        {homeHint && <span className="s">{homeHint}</span>}
      </div>

      <div className="grid gap-2" data-testid={`${testid}-cars`}>
        <span className="lbl">Cars</span>
        {rows.length === 0 && <span className="s">No car yet. Gas estimates need one with its MPG.</span>}
        {rows.map((r, i) => (
          <div key={r.key} className="flex flex-wrap items-start gap-3" data-testid={`${testid}-car-${i}`}>
            <div className="grid min-w-[200px] flex-[2_1_200px] gap-1">
              <label htmlFor={`${testid}-car-name-${i}`} className="sr-only">Car {i + 1} name</label>
              <input id={`${testid}-car-name-${i}`} className="input" value={r.name} placeholder="e.g. 2015 Subaru Outback" data-testid={`${testid}-car-name-${i}`}
                aria-invalid={!!errors[`${r.key}.name`]} onChange={(e) => edit(r.key, { name: e.target.value })} onBlur={() => onCommit?.(rows)} />
              {errors[`${r.key}.name`] && <span className="err" data-testid={`${testid}-car-name-error-${i}`}>{errors[`${r.key}.name`]}</span>}
            </div>
            <div className="grid min-w-[100px] flex-[1_1_100px] gap-1">
              <label htmlFor={`${testid}-car-mpg-${i}`} className="sr-only">Car {i + 1} MPG</label>
              <input id={`${testid}-car-mpg-${i}`} className="input" inputMode="decimal" value={r.mpg} placeholder="MPG, e.g. 28" data-testid={`${testid}-car-mpg-${i}`}
                aria-invalid={!!errors[`${r.key}.mpg`]} onChange={(e) => edit(r.key, { mpg: e.target.value })} onBlur={() => onCommit?.(rows)} />
              {errors[`${r.key}.mpg`] && <span className="err" data-testid={`${testid}-car-mpg-error-${i}`}>{errors[`${r.key}.mpg`]}</span>}
            </div>
            <div className="grid min-w-[130px] flex-[1_1_130px] gap-1">
              <label htmlFor={`${testid}-car-grade-${i}`} className="sr-only">Car {i + 1} fuel</label>
              <select id={`${testid}-car-grade-${i}`} className="select" value={r.fuelGrade} data-testid={`${testid}-car-grade-${i}`}
                onChange={(e) => edit(r.key, { fuelGrade: e.target.value as FuelGrade }, true)}>
                {GRADES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <button type="button" className="btn text" onClick={() => remove(r.key)} data-testid={`${testid}-car-remove-${i}`} aria-label={`Remove ${r.name || `car ${i + 1}`}`}>Remove</button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" className="btn outline" onClick={() => setRows([...rows, newCarDraft()])} data-testid={`${testid}-car-add`}>+ Add car</button>
          <a href={FEG_URL} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent" data-testid={`${testid}-mpg-lookup`}>Look up a car&apos;s MPG</a>
        </div>
      </div>
    </div>
  );
}
