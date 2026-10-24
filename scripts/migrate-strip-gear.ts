/**
 * Artists no longer carry gear lists (each show has its own):
 *   tsx scripts/migrate-strip-gear.ts [--dry-run] [--yes]
 * Strips `configurations[].gear` and `soundGear` from every artist doc. The artist schema is strict, so until this has run
 * any edit to an artist that still has those fields is rejected. Shows keep their own gear lists untouched.
 * Live docs are written through the normal writer (history + rev, via "import"); soft-deleted artists are fixed in place.
 * Safe to run again: it only touches docs that still have the old fields. Against real Firestore (no emulator host) it needs --yes.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { db } from "@/server/db";

export interface StripGearResult { artists: { id: string; name: string; configurations: number; soundGear: boolean }[] }

export async function stripGear(fs: Firestore, opts: { dryRun?: boolean } = {}): Promise<StripGearResult> {
  const ctx = importCtx("migrate-strip-gear");
  const docs = (await fs.collection("artists").get()).docs.map((d) => ({ id: d.id, ...d.data() }) as { id: string; name?: string; configurations?: Record<string, unknown>[]; soundGear?: unknown; deletedAt?: unknown });
  const out: StripGearResult["artists"] = [];
  for (const a of docs) {
    const cfgs = Array.isArray(a.configurations) ? a.configurations : [];
    const withGear = cfgs.filter((c) => "gear" in c).length;
    const hasSound = "soundGear" in a;
    if (!withGear && !hasSound) continue;
    out.push({ id: a.id, name: a.name ?? "", configurations: withGear, soundGear: hasSound });
    if (opts.dryRun) continue;
    const configurations = cfgs.map(({ gear: _gear, ...rest }) => { void _gear; return rest; });
    if (a.deletedAt) await fs.collection("artists").doc(a.id).update({ configurations, soundGear: FieldValue.delete() });
    else await db.update(ctx, "artists", a.id, { configurations, soundGear: null });
  }
  return { artists: out };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await stripGear(firestore(), { dryRun: flag("dry-run") });
  const verb = flag("dry-run") ? "Would strip" : "Stripped";
  for (const a of r.artists) console.log(`${verb} artist ${a.id} (${a.name}): gear from ${a.configurations} configuration(s)${a.soundGear ? ", soundGear" : ""}`);
  console.log(`${r.artists.length} artist(s) ${flag("dry-run") ? "need" : "cleaned of"} gear fields.`);
}

if (process.argv[1]?.endsWith("migrate-strip-gear.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
