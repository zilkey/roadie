/**
 * Rehearsals used to carry a free-text `place`. They now carry `location` ({name, address, lat, lng}), so directions and gas
 * estimates have coordinates to work from:
 *   tsx scripts/migrate-rehearsal-location.ts [--dry-run] [--yes]
 *
 * For every rehearsal that still has a `place` field:
 *   - no `location` yet: the text moves into `location.name`, with NO address or coordinates (the app fills those in when
 *     someone picks the place from the autocomplete);
 *   - already has a `location`: that location is kept, only `place` is removed;
 *   - an empty `place` only has the field removed.
 * Live rehearsals are written through db.ts (one History run for the whole migration, so Admin -> History -> Undo reverses it).
 * Soft-deleted rehearsals are fixed in place with the admin SDK, like migrate-venue-notes does for archived venues (Writer.update
 * refuses deleted docs); nothing else about them changes. Rehearsals without `place` are skipped, so it is safe to run again.
 * Against real Firestore (no emulator host) it needs --yes.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx, newRunId } from "@/server/ctx";
import { run } from "@/server/db";

export interface MigrateRehearsalLocationResult {
  runId: string;
  /** Rehearsals that still had `place`. */
  found: number;
  /** Of those, how many got a new `location.name` (the rest kept their existing location, or had nothing to move). */
  locationSet: number;
  /** Of those, how many were soft-deleted (fixed in place, not in History). */
  archived: number;
  /** Rehearsals with no `place` field: left alone. */
  skipped: number;
}

export async function migrateRehearsalLocation(fs: Firestore, opts: { dryRun?: boolean } = {}): Promise<MigrateRehearsalLocationResult> {
  const runId = newRunId();
  const ctx = importCtx("migrate-rehearsal-location", runId);
  const out: MigrateRehearsalLocationResult = { runId, found: 0, locationSet: 0, archived: 0, skipped: 0 };

  for (const d of (await fs.collection("rehearsals").get()).docs) {
    const data = d.data();
    if (!("place" in data)) {
      out.skipped++;
      continue;
    }
    const text = typeof data.place === "string" ? data.place.trim() : "";
    const hasLocation = data.location !== undefined && data.location !== null;
    const moveText = !hasLocation && text !== "";
    const archived = !!data.deletedAt;
    out.found++;
    if (moveText) out.locationSet++;
    if (archived) out.archived++;
    if (opts.dryRun) continue;

    if (archived) {
      // Writer.update refuses archived docs: take the old field off directly (and move the text, if there is any to move).
      await fs.doc(`rehearsals/${d.id}`).update({
        place: FieldValue.delete(),
        ...(moveText ? { location: { name: text } } : {}),
      });
    } else {
      await run(ctx, (w) => w.update("rehearsals", d.id, {
        place: null,
        ...(moveText ? { location: { name: text } } : {}),
      }));
    }
  }
  return out;
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const dry = flag("dry-run");
  const r = await migrateRehearsalLocation(firestore(), { dryRun: dry });
  console.log(`${dry ? "Would move" : "Moved"} the place into location.name on ${r.locationSet} rehearsal(s); ${r.found} rehearsal(s) had a place field (${r.archived} archived), ${r.skipped} had none.`);
  if (!dry && r.found) console.log(`History run ${r.runId}: Admin -> History -> filter by this run id -> Undo reverses the live rehearsals (archived ones are not in History).`);
  console.log(`Run id: ${r.runId}`);
  if (dry) console.log("(dry run, nothing written)");
}

if (process.argv[1]?.endsWith("migrate-rehearsal-location.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
