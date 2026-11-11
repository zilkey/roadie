/**
 * Which EIA weekly price applies, and fetching/caching it in fuelPrices/{seriesId}.
 *
 * The ladder, from the From address's county and state: metro (EIA's 10 city panels, matched by county from EIA's
 * published city definitions, kept in ./counties.json) → state (the 9 with their own series: CA, CO, FL, MA, MN,
 * NY, OH, TX, WA) → PADD region → U.S. The duoarea and product facet codes come from EIA's own metadata for
 * petroleum/pri/gnd — never guessed.
 *
 * priceFor reads fuelPrices/{seriesId} (seriesId = `${duoarea}_${product}`). When the doc is missing or its
 * fetchedAt is more than 7 days old, it fetches from EIA (eiaClient), stores the doc (directly with the admin SDK,
 * no history) and uses it. When the fetch fails it uses the stored price; with neither it returns null.
 */
import { Timestamp } from "firebase-admin/firestore";
import type { FuelAreaKind, FuelGrade } from "@/schema";
import { firestore } from "@/server/admin";
import { eiaClient } from "@/server/integrations/eia";
import counties from "./counties.json";

export interface PriceArea {
  areaKind: FuelAreaKind;
  /** Display name: "Denver", "Colorado", "PADD 4", "U.S." */
  area: string;
  /** The EIA duoarea facet code for this area. */
  duoarea: string;
}

export interface PriceResult {
  priceMilli: number;
  /** YYYY-MM-DD, the EIA period. */
  week: string;
  seriesId: string;
  area: string;
  areaKind: FuelAreaKind;
  grade: FuelGrade;
  /** What the expense shows: "Denver-area average · EIA weekly, Oct 19". */
  source: string;
}

// Facet codes from EIA API v2 metadata: /v2/petroleum/pri/gnd/facet/duoarea and /facet/product.
const METRO: Record<string, string> = {
  "Boston": "YBOS", "Chicago": "YORD", "Cleveland": "YCLE", "Denver": "YDEN", "Houston": "Y44HO",
  "Los Angeles": "Y05LA", "Miami": "YMIA", "New York City": "Y35NY", "San Francisco": "Y05SF", "Seattle": "Y48SE",
};
const STATE: Record<string, { name: string; duoarea: string }> = {
  CA: { name: "California", duoarea: "SCA" }, CO: { name: "Colorado", duoarea: "SCO" }, FL: { name: "Florida", duoarea: "SFL" },
  MA: { name: "Massachusetts", duoarea: "SMA" }, MN: { name: "Minnesota", duoarea: "SMN" }, NY: { name: "New York", duoarea: "SNY" },
  OH: { name: "Ohio", duoarea: "SOH" }, TX: { name: "Texas", duoarea: "STX" }, WA: { name: "Washington", duoarea: "SWA" },
};
// PADD 1 is split into 1A/1B/1C, each with its own series; the others are single regions.
const PADDS: { name: string; duoarea: string; states: string[] }[] = [
  { name: "PADD 1A (New England)", duoarea: "R1X", states: ["CT", "ME", "MA", "NH", "RI", "VT"] },
  { name: "PADD 1B (Central Atlantic)", duoarea: "R1Y", states: ["DE", "DC", "MD", "NJ", "NY", "PA"] },
  { name: "PADD 1C (Lower Atlantic)", duoarea: "R1Z", states: ["FL", "GA", "NC", "SC", "VA", "WV"] },
  { name: "PADD 2 (Midwest)", duoarea: "R20", states: ["IL", "IN", "IA", "KS", "KY", "MI", "MN", "MO", "NE", "ND", "OH", "OK", "SD", "TN", "WI"] },
  { name: "PADD 3 (Gulf Coast)", duoarea: "R30", states: ["AL", "AR", "LA", "MS", "NM", "TX"] },
  { name: "PADD 4 (Rocky Mountain)", duoarea: "R40", states: ["CO", "ID", "MT", "UT", "WY"] },
  { name: "PADD 5 (West Coast)", duoarea: "R50", states: ["AK", "AZ", "CA", "HI", "NV", "OR", "WA"] },
];
const PRODUCT: Record<FuelGrade, string> = { regular: "EPMR", midgrade: "EPMM", premium: "EPMP", diesel: "EPD2D" };

const norm = (s: string) => s.toLowerCase().replace(/\bcounty\b/g, "").replace(/[^a-z0-9]/g, "");
const metroByCounty = new Map<string, string>();
for (const [st, m] of Object.entries(counties as Record<string, Record<string, string>>)) {
  for (const [c, city] of Object.entries(m)) metroByCounty.set(`${st}|${norm(c)}`, city);
}

/**
 * The price area for a US county + state (as ORS returns them: county like "Denver County" or "Denver",
 * state as the two-letter code). Case-insensitive; a missing or unknown county falls through the ladder;
 * no match at all → U.S.
 */
export function areaFor(county: string | undefined, state: string | undefined): PriceArea {
  const st = state?.trim().toUpperCase() ?? "";
  if (county && st) {
    const city = metroByCounty.get(`${st}|${norm(county)}`);
    if (city) return { areaKind: "metro", area: city, duoarea: METRO[city] };
  }
  if (STATE[st]) return { areaKind: "state", area: STATE[st].name, duoarea: STATE[st].duoarea };
  const padd = PADDS.find((p) => p.states.includes(st));
  if (padd) return { areaKind: "padd", area: padd.name, duoarea: padd.duoarea };
  return { areaKind: "us", area: "U.S.", duoarea: "NUS" };
}

/** The EIA product facet code for a fuel grade. */
export function productFor(grade: FuelGrade): string {
  return PRODUCT[grade];
}

const WEEK_MS = 7 * 86400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function sourceText(area: string, kind: FuelAreaKind, week: string): string {
  const [, m, d] = week.split("-").map(Number);
  const label = kind === "metro" ? `${area}-area` : area.replace(/\s*\(.*\)$/, "");
  return `${label} average · EIA weekly, ${MONTHS[m - 1]} ${d}`;
}

/** The current weekly price for an area × grade, cache-first (see module doc). Null when there is no price at all. */
export async function priceFor(area: PriceArea, grade: FuelGrade): Promise<PriceResult | null> {
  const seriesId = `${area.duoarea}_${productFor(grade)}`;
  const ref = firestore().doc(`fuelPrices/${seriesId}`);
  const snap = await ref.get();
  const stored = snap.exists ? (snap.data() as { priceMilli: number; week: string; fetchedAt?: Timestamp }) : undefined;
  const result = (priceMilli: number, week: string): PriceResult => ({
    priceMilli, week, seriesId, area: area.area, areaKind: area.areaKind, grade, source: sourceText(area.area, area.areaKind, week),
  });
  if (stored?.fetchedAt && Date.now() - stored.fetchedAt.toMillis() <= WEEK_MS) return result(stored.priceMilli, stored.week);
  try {
    const row = await eiaClient().latest({ duoarea: area.duoarea, product: productFor(grade) });
    if (row && Number.isFinite(row.value)) {
      const priceMilli = Math.round(row.value * 1000);
      await ref.set({ area: area.area, areaKind: area.areaKind, grade, priceMilli, week: row.period, fetchedAt: Timestamp.now() });
      return result(priceMilli, row.period);
    }
  } catch {
    // fall through to the stored price
  }
  return stored ? result(stored.priceMilli, stored.week) : null;
}
