/**
 * A person's Driving & gas settings: users/{uid}.driving (home address and cars). Written through db.ts like any other
 * field, so every change has a history entry and history.undoRun can put it back. Admins and the person read it.
 */
import { randomUUID } from "node:crypto";
import { db, run, type Writer } from "./db";
import { AppError } from "./errors";
import type { Ctx } from "./ctx";
import { DrivingSettings, type Car, type FuelGrade, type GeoPoint } from "@/schema";

/** A car as the commands take it: no id means a new car (the server gives it one). mpg null clears it. */
export interface CarIn { id?: string; name: string; mpg?: number | null; fuelGrade?: FuelGrade }
export interface DrivingPatch {
  home?: GeoPoint | null;
  /** The whole list, in order: cars left out are removed. */
  cars?: CarIn[];
}

const newCarId = () => randomUUID().slice(0, 8);

/** The saved settings ({} when none). */
export async function getDriving(uid: string): Promise<DrivingSettings> {
  const u = await db.get("users", uid);
  return (u?.driving as DrivingSettings | undefined) ?? {};
}

/** The patch applied to the current settings: cars keep their ids (new ones get one), mpg null clears it. */
export function applyDriving(cur: DrivingSettings, patch: DrivingPatch): DrivingSettings {
  const next: DrivingSettings = { ...cur };
  if (patch.home === null) delete next.home; else if (patch.home) next.home = patch.home;
  if (patch.cars) {
    const old = new Map((cur.cars ?? []).map((c) => [c.id, c]));
    next.cars = patch.cars.map((c): Car => {
      if (c.id && !old.has(c.id)) throw new AppError("invalid_input", `No car with id ${c.id}`, 400, [{ path: ["cars"], message: "Unknown car id" }]);
      const was = c.id ? old.get(c.id) : undefined;
      const mpg = c.mpg === undefined ? was?.mpg : c.mpg ?? undefined;
      return { id: c.id ?? newCarId(), name: c.name.trim(), ...(mpg !== undefined ? { mpg } : {}), fuelGrade: c.fuelGrade ?? was?.fuelGrade ?? "regular" };
    });
  }
  return DrivingSettings.parse(next);
}

/** Patch someone's settings inside a write unit. Returns what is now saved. */
export async function writeDriving(w: Writer, uid: string, patch: DrivingPatch): Promise<DrivingSettings> {
  const u = await w.get("users", uid);
  if (!u || u.deletedAt) throw new AppError("not_found", "User not found", 404);
  const next = applyDriving((u.driving as DrivingSettings | undefined) ?? {}, patch);
  await w.update("users", uid, { driving: next });
  return next;
}

/** Patch someone's settings in its own write unit (one run, undoable). */
export const updateDriving = (ctx: Ctx, uid: string, patch: DrivingPatch) => run(ctx, (w) => writeDriving(w, uid, patch));

/**
 * Save an MPG the gas form typed: onto the car the estimate used (carId), else the only car, else a new car named
 * "Car" when there are none. With several cars and no carId there is no telling which, so nothing changes (null).
 */
export function withMpg(cur: DrivingSettings, mpg: number, carId?: string): DrivingPatch | null {
  const cars = cur.cars ?? [];
  const target = carFor(cur, carId);
  if (target) return { cars: cars.map((c) => (c.id === target.id ? { ...c, mpg } : c)) };
  if (!cars.length) return { cars: [{ name: "Car", mpg }] };
  return null;
}

/** The car an estimate uses: the one asked for, else the only one. */
export function carFor(cur: DrivingSettings, carId?: string): Car | undefined {
  const cars = cur.cars ?? [];
  if (carId) return cars.find((c) => c.id === carId);
  return cars.length === 1 ? cars[0] : undefined;
}
