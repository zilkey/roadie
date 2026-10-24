/**
 * A pitch's `pitchedAs` is a configuration id, but the old flag form saved free text ("Duo"):
 *   tsx scripts/migrate-pitched-as.ts [--dry-run] [--yes]
 * For every pitch whose `pitchedAs` is not one of its artist's configuration ids:
 *   - if the text matches a configuration name (case-insensitive, trimmed) or id, `pitchedAs` becomes that id;
 *   - otherwise `pitchedAs` is cleared and the old text is appended to the pitch notes ("Pitched as: Duo").
 * Personnel is left alone. Live docs are written through the normal writer (history + rev, via "import");
 * soft-deleted pitches are fixed in place. Safe to run again: it only touches pitches whose `pitchedAs` is not a valid id.
 * Against real Firestore (no emulator host) it needs --yes.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { db } from "@/server/db";

export interface MigratePitchedAsResult {
  matched: { id: string; target: string; from: string; to: string }[];
  cleared: { id: string; target: string; from: string }[];
}

export async function migratePitchedAs(fs: Firestore, opts: { dryRun?: boolean } = {}): Promise<MigratePitchedAsResult> {
  const ctx = importCtx("migrate-pitched-as");
  const artists = new Map((await fs.collection("artists").get()).docs.map((d) => [d.id, (d.data().configurations ?? []) as { id: string; name: string }[]]));
  const pitches = (await fs.collection("pitches").get()).docs.map((d) => ({ id: d.id, ...d.data() }) as { id: string; artistId?: string; pitchedAs?: unknown; notes?: string; target?: { name?: string }; deletedAt?: unknown });
  const out: MigratePitchedAsResult = { matched: [], cleared: [] };
  for (const p of pitches) {
    if (typeof p.pitchedAs !== "string" || p.pitchedAs === "") continue;
    const configs = (p.artistId && artists.get(p.artistId)) || [];
    if (configs.some((c) => c.id === p.pitchedAs)) continue;
    const text = p.pitchedAs.trim().toLowerCase();
    const hit = text ? configs.find((c) => c.name.trim().toLowerCase() === text || c.id.toLowerCase() === text) : undefined;
    const target = p.target?.name ?? "";
    let patch: Record<string, unknown>;
    if (hit) {
      out.matched.push({ id: p.id, target, from: p.pitchedAs, to: hit.id });
      patch = { pitchedAs: hit.id };
    } else {
      out.cleared.push({ id: p.id, target, from: p.pitchedAs });
      patch = { pitchedAs: null };
      if (p.pitchedAs.trim()) patch.notes = [p.notes?.trim(), `Pitched as: ${p.pitchedAs.trim()}`].filter(Boolean).join("\n");
    }
    if (opts.dryRun) continue;
    if (p.deletedAt) await fs.collection("pitches").doc(p.id).update({ ...patch, pitchedAs: patch.pitchedAs ?? FieldValue.delete() });
    else await db.update(ctx, "pitches", p.id, patch);
  }
  return out;
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await migratePitchedAs(firestore(), { dryRun: flag("dry-run") });
  const verb = flag("dry-run") ? "Would set" : "Set";
  for (const m of r.matched) console.log(`${verb} pitch ${m.id} (${m.target}): "${m.from}" -> configuration ${m.to}`);
  for (const c of r.cleared) console.log(`${flag("dry-run") ? "Would clear" : "Cleared"} pitch ${c.id} (${c.target}): "${c.from}" moved to notes`);
  console.log(`${r.matched.length} pitch(es) matched to a configuration, ${r.cleared.length} cleared into notes${flag("dry-run") ? " (dry run, nothing written)" : ""}.`);
}

if (process.argv[1]?.endsWith("migrate-pitched-as.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
