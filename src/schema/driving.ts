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

/**
 * users/{uid}/private/driving. Read and written ONLY through src/server/driving.ts (admin SDK, like userPrefs),
 * never through db.ts: a history entry would put the home address where admins can read it. Rules let only the
 * owner read it; the server reads it for estimates and never returns the address to anyone else.
 */
export const DrivingSettings = z.strictObject({
  home: geoPoint.optional(),
  carName: z.string().optional(),
  mpg: z.number().positive().optional(),
  fuelGrade,
  updatedAt: ts,
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
