/**
 * A pitch's `dates` used to be a list of {date, endDate?, note?}; it is now a plain list of "YYYY-MM-DD" strings:
 *   tsx scripts/migrate-pitch-dates.ts [--dry-run] [--yes]
 * For every pitch whose `dates` holds an object, `dates` becomes the sorted, unique list of those objects' `date`s.
 * A run's endDate and a date's note are dropped (the model has no place for them); a note is appended to the pitch notes
 * ("Dates: Jan 16 (hold)") so nothing the band wrote is lost. Live docs are written through the normal writer (history + rev,
 * via "import"); soft-deleted pitches are fixed in place. Safe to run again: it only touches pitches that still hold an object.
 * Against real Firestore (no emulator host) it needs --yes.
 */
import type { Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { db } from "@/server/db";

export interface MigratePitchDatesResult {
  migrated: { id: string; target: string; from: unknown[]; to: string[]; notes?: string }[];
}

const isOld = (d: unknown): d is { date: string; endDate?: string; note?: string } => typeof d === "object" && d !== null && typeof (d as { date?: unknown }).date === "string";

export async function migratePitchDates(fs: Firestore, opts: { dryRun?: boolean } = {}): Promise<MigratePitchDatesResult> {
  const ctx = importCtx("migrate-pitch-dates");
  const pitches = (await fs.collection("pitches").get()).docs.map((d) => ({ id: d.id, ...d.data() }) as { id: string; dates?: unknown[]; notes?: string; target?: { name?: string }; deletedAt?: unknown });
  const out: MigratePitchDatesResult = { migrated: [] };
  for (const p of pitches) {
    if (!Array.isArray(p.dates) || !p.dates.some(isOld)) continue;
    const to = [...new Set(p.dates.map((d) => (isOld(d) ? d.date : String(d))))].sort();
    const lost = p.dates.filter(isOld).filter((d) => d.endDate || d.note).map((d) => `${d.date}${d.endDate && d.endDate !== d.date ? ` to ${d.endDate}` : ""}${d.note ? ` (${d.note})` : ""}`);
    const notes = lost.length ? [p.notes?.trim(), `Dates: ${lost.join(", ")}`].filter(Boolean).join("\n") : undefined;
    out.migrated.push({ id: p.id, target: p.target?.name ?? "", from: p.dates, to, ...(notes ? { notes } : {}) });
    if (opts.dryRun) continue;
    const patch = { dates: to, ...(notes ? { notes } : {}) };
    if (p.deletedAt) await fs.collection("pitches").doc(p.id).update(patch);
    else await db.update(ctx, "pitches", p.id, patch);
  }
  return out;
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await migratePitchDates(firestore(), { dryRun: flag("dry-run") });
  for (const m of r.migrated) console.log(`${flag("dry-run") ? "Would set" : "Set"} pitch ${m.id} (${m.target}): ${m.to.join(", ") || "no dates"}${m.notes ? " (range ends / notes moved to the pitch notes)" : ""}`);
  console.log(`${r.migrated.length} pitch(es) migrated${flag("dry-run") ? " (dry run, nothing written)" : ""}.`);
}

if (process.argv[1]?.endsWith("migrate-pitch-dates.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
