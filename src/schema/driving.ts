import { z } from "zod";
import { dateStr, ts } from "./common";

export const fuelGrade = z.enum(["regular", "midgrade", "premium", "diesel"]);
export type FuelGrade = z.infer<typeof fuelGrade>;

/** A geocoded place as ORS autocomplete returns it and as driving settings store it. */
export const geoPoint = z.strictObject({
  name: z.string().optional(),
  address: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
});
export type GeoPoint = z.infer<typeof geoPoint>;

/** One car a person drives. Gas estimates use its MPG and fuel grade. */
export const Car = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  mpg: z.number().positive().optional(),
  fuelGrade,
});
export type Car = z.infer<typeof Car>;

/**
 * A person's Driving & gas settings: users/{uid}.driving. Written through db.ts like any other field (history, undo),
 * by me.updateDriving (their own) and people.updateDriving (admins, for a bandmate). Admins and the person read it.
 * With one car, gas estimates use it; with several, the estimate asks which (expenses.estimateGas carId).
 */
export const DrivingSettings = z.strictObject({
  home: geoPoint.optional(),
  cars: z.array(Car).refine((cs) => new Set(cs.map((c) => c.id)).size === cs.length, "One entry per car").optional(),
});
export type DrivingSettings = z.infer<typeof DrivingSettings>;

export const fuelAreaKind = z.enum(["metro", "state", "padd", "us"]);
export type FuelAreaKind = z.infer<typeof fuelAreaKind>;

/**
 * fuelPrices/{seriesId}: the stored EIA weekly retail price for one area × grade, shared by every band.
 * seriesId is `${duoarea}_${product}` (the EIA facet codes), so the doc is findable without calling EIA.
 * Server-written (directly, no history); any signed-in user reads.
 */
export const FuelPrice = z.strictObject({
  /** Display name: "Denver", "Colorado", "PADD 4", "U.S." */
  area: z.string(),
  areaKind: fuelAreaKind,
  grade: fuelGrade,
  /** $/gal × 1000 */
  priceMilli: z.number().int().positive(),
  /** The EIA period the price is for (YYYY-MM-DD, a Monday). */
  week: dateStr,
  fetchedAt: ts,
});
export type FuelPrice = z.infer<typeof FuelPrice>;

/** routeCache/{key}: key = hash of start+end coordinates rounded to 3 decimals, never an address. Server-only, 30-day TTL. minutes is missing on entries cached before tours kept the drive time. */
export const RouteCacheEntry = z.strictObject({ oneWayMiles: z.number(), minutes: z.number().optional(), at: ts });
export type RouteCacheEntry = z.infer<typeof RouteCacheEntry>;
