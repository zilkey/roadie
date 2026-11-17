/**
 * Tenancy phase 8: give every artist without a time zone one (`artists.timeZone`, required from phase 8's second push).
 *   npm run migrate:time-zones                          (dry run: lists the artists it would change, changes nothing)
 *   npm run migrate:time-zones -- --apply               (sets them, through the Writer: History says "migrate-time-zones")
 *   npm run migrate:time-zones -- --zone America/Chicago [--apply]   (another zone; default America/Denver, where the first band is)
 * Against the emulator, set FIRESTORE_EMULATOR_HOST; against prod, GCLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS. It refuses to
 * guess a target. Safe to run again: an artist that has a zone is never touched, so a second dry run reports 0.
 */
import { db } from "@/server/db";
import { importCtx, systemCtx } from "@/server/ctx";
import { isTimeZone } from "@/schema";
import { DEFAULT_TIME_ZONE } from "@/lib/timezone";

export interface ZoneReport { zone: string; apply: boolean; total: number; missing: { id: string; name: string }[] }

/** The artists (deleted ones included) with no time zone; with `apply`, each gets `zone`. */
export async function migrateTimeZones({ apply, zone = DEFAULT_TIME_ZONE }: { apply: boolean; zone?: string }): Promise<ZoneReport> {
  if (!isTimeZone(zone)) throw new Error(`Not a time zone: ${zone}`);
  const artists = await db.list(systemCtx("migrate-time-zones"), "artists", undefined, { includeDeleted: true });
  const missing = artists.filter((a) => typeof a.timeZone !== "string" || !a.timeZone).map((a) => ({ id: a.id, name: String(a.name) }));
  if (apply) for (const a of missing) await db.update(importCtx(a.id, "migrate-time-zones"), "artists", a.id, { timeZone: zone });
  return { zone, apply, total: artists.length, missing };
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const at = argv.indexOf("--zone");
  const zone = at >= 0 ? argv[at + 1] : DEFAULT_TIME_ZONE;
  const project = process.env.GCLOUD_PROJECT, emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (!project && !emulator) throw new Error("No target: set GCLOUD_PROJECT (real Firestore) or FIRESTORE_EMULATOR_HOST (emulator). Refusing to guess.");
  console.log(`Target: ${project ?? "demo-band-tracker"} (${emulator ? `emulator at ${emulator}` : "REAL Firestore"})${apply ? "" : ", dry run"}`);
  const r = await migrateTimeZones({ apply, zone });
  console.log(`${r.total} artist(s); ${r.missing.length} without a time zone${r.missing.length ? `, ${apply ? "set to" : "would get"} ${r.zone}:` : "."}`);
  for (const a of r.missing) console.log(`  ${a.id} ${a.name}`);
  if (!apply && r.missing.length) console.log("(dry run, nothing changed; re-run with --apply)");
}

if (process.argv[1]?.endsWith("migrate-time-zones.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
