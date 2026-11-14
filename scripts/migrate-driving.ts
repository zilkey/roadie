/**
 * Move each person's Driving & gas settings from users/{uid}/private/driving (written outside history) onto their
 * users doc as users/{uid}.driving, the shape the app now reads: { home, cars: [{ id, name, mpg, fuelGrade }] }.
 *   npm run migrate:driving                 (dry run: reports what it would do, changes nothing)
 *   npm run migrate:driving -- --apply      (does it)
 * Against the emulator, set FIRESTORE_EMULATOR_HOST; against prod, GCLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS
 * as for the other scripts. Run it after the release that reads users/{uid}.driving is live.
 *
 * The old doc's car name, MPG and fuel grade become one car (named "Car" when it had MPG but no name); a home address
 * moves as it is. The users doc is written through db.ts (one history entry, undoable), then the old doc is deleted.
 * A person who already has users.driving keeps it (their old doc is only deleted), so running it again changes nothing.
 */
import { db } from "@/server/db";
import { firestore } from "@/server/admin";
import { importCtx, newRunId } from "@/server/ctx";
import { applyDriving, type CarIn } from "@/server/driving";
import type { FuelGrade, GeoPoint } from "@/schema";

interface Old { home?: GeoPoint; carName?: string; mpg?: number; fuelGrade?: FuelGrade }
export interface Moved { uid: string; name: string; home: boolean; car: string | null }
export interface MigrateDrivingResult { apply: boolean; runId: string; moved: Moved[]; kept: string[]; skipped: { uid: string; reason: string }[] }

export async function migrateDriving(opts: { apply: boolean; log?: (s: string) => void }): Promise<MigrateDrivingResult> {
  const log = opts.log ?? (() => undefined);
  const runId = newRunId();
  const ctx = importCtx("migrate-driving", runId);
  const out: MigrateDrivingResult = { apply: opts.apply, runId, moved: [], kept: [], skipped: [] };
  const docs = (await firestore().collectionGroup("private").get()).docs.filter((d) => d.id === "driving" && d.ref.parent.parent?.parent.id === "users");
  for (const d of docs) {
    const uid = d.ref.parent.parent!.id;
    const old = d.data() as Old;
    const user = await db.get("users", uid);
    if (!user || user.deletedAt) { out.skipped.push({ uid, reason: "no live user (old doc left as it is)" }); continue; }
    const name = (user.name as string) ?? uid;
    if (user.driving) {
      out.kept.push(uid);
      log(`${name}: already has users.driving; ${opts.apply ? "deleting" : "would delete"} the old doc`);
      if (opts.apply) await d.ref.delete();
      continue;
    }
    const cars: CarIn[] = old.carName || old.mpg !== undefined
      ? [{ name: old.carName?.trim() || "Car", ...(old.mpg !== undefined ? { mpg: old.mpg } : {}), fuelGrade: old.fuelGrade ?? "regular" }]
      : [];
    const driving = applyDriving({}, { ...(old.home ? { home: old.home } : {}), cars });
    out.moved.push({ uid, name, home: !!old.home, car: cars[0] ? `${cars[0].name}${cars[0].mpg !== undefined ? ` (${cars[0].mpg} MPG)` : ""}` : null });
    log(`${name}: ${old.home ? "home" : "no home"}, ${cars[0] ? `car ${cars[0].name}${cars[0].mpg !== undefined ? ` ${cars[0].mpg} MPG` : ""} ${cars[0].fuelGrade}` : "no car"}`);
    if (!opts.apply) continue;
    await db.update(ctx, "users", uid, { driving });
    await d.ref.delete();
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const r = await migrateDriving({ apply, log: (s) => console.log(s) });
  console.log(`${apply ? "Moved" : "Would move"} ${r.moved.length}; already moved ${r.kept.length}; skipped ${r.skipped.length}.${apply && r.moved.length ? ` runId ${r.runId}` : ""}`);
  for (const s of r.skipped) console.log(`  skipped ${s.uid}: ${s.reason}`);
  if (!apply) console.log("Dry run: nothing changed. Run again with --apply.");
}
if (process.argv[1]?.endsWith("migrate-driving.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
