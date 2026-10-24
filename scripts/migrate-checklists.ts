/**
 * Moves show checklists and checklist templates to the template shape (named lists you pick by hand), without losing anything:
 *   tsx scripts/migrate-checklists.ts [--dry-run] [--yes]
 *   1. A show still on the old checklist + gear fields (migrate:show-page never ran on it) -> checklists ("Gig prep", "Gear"); the old fields are cleared.
 *   2. Every show list gets templateId: null when it has none, and its items lose their due date. Nothing else changes:
 *      ids, labels, done, ownerId, list names and order (any "Gear" or "Gig prep" list included) are kept.
 *   3. The old rule-shaped checklistTemplates (with `when`) are soft-deleted.
 *   4. Every live artist with no live new-shape template gets the defaults (Promo, Follow Up).
 * Live docs are written through the normal writer (history + rev, via "import"); soft-deleted shows are fixed in place.
 * Safe to run again: each step only touches docs still in the old shape. Against real Firestore (no emulator host) it needs --yes.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { run } from "@/server/db";
import { seedDefaultTemplates } from "@/server/checklistTemplates";
import { checklistsOf, type ChecklistLike } from "@/lib/shows";

export interface MigrateChecklistsResult {
  /** Shows converted from the legacy checklist/gear fields. */
  showsConverted: number;
  /** Lists written with a change: converted from legacy, given templateId: null, or stripped of due dates. */
  listsTouched: number;
  dueStripped: number;
  templatesRetired: number;
  /** Artists given the default templates. */
  artistsSeeded: number;
}

type Row = Record<string, unknown> & { id: string };
type ListIn = Omit<ChecklistLike, "items"> & { items: (ChecklistLike["items"][number] & { due?: string })[] };

export async function migrateChecklists(fs: Firestore, opts: { dryRun?: boolean } = {}): Promise<MigrateChecklistsResult> {
  const ctx = importCtx("migrate-checklists");
  const rows = async (path: string) => (await fs.collection(path).get()).docs.map((d) => ({ ...d.data(), id: d.id }) as Row);
  const [shows, templates, artists] = await Promise.all([rows("shows"), rows("checklistTemplates"), rows("artists")]);
  const out: MigrateChecklistsResult = { showsConverted: 0, listsTouched: 0, dueStripped: 0, templatesRetired: 0, artistsSeeded: 0 };

  for (const s of shows) {
    const legacy = !s.checklists && (s.checklist !== undefined || s.gear !== undefined);
    const legacyDue = legacy ? ((s.checklist as { due?: string }[] | undefined) ?? []).filter((i) => i.due !== undefined).length : 0;
    const lists = (legacy ? checklistsOf(s as never) : ((s.checklists as ListIn[] | undefined) ?? [])) as ListIn[];
    let touched = 0, due = legacyDue;
    const next = lists.map((l) => {
      const dues = l.items.filter((i) => i.due !== undefined).length;
      if (legacy || dues || l.templateId === undefined) touched++;
      due += dues;
      return { ...l, templateId: l.templateId ?? null, items: l.items.map(({ due: _due, ...i }) => i) };
    });
    if (!legacy && !touched) continue;
    if (legacy) out.showsConverted++;
    out.listsTouched += touched;
    out.dueStripped += due;
    const patch: Record<string, unknown> = { checklists: next, ...(s.checklist !== undefined ? { checklist: null } : {}), ...(s.gear !== undefined ? { gear: null } : {}) };
    if (opts.dryRun) continue;
    if (s.deletedAt) await fs.collection("shows").doc(s.id).update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === null ? FieldValue.delete() : v])));
    else await run(ctx, (w) => w.update("shows", s.id, patch));
  }

  for (const t of templates.filter((x) => x.when !== undefined && !x.deletedAt)) {
    out.templatesRetired++;
    if (!opts.dryRun) await run(ctx, (w) => w.softDelete("checklistTemplates", t.id));
  }

  const hasTemplates = new Set(templates.filter((t) => t.when === undefined && !t.deletedAt && typeof t.artistId === "string").map((t) => t.artistId as string));
  for (const a of artists.filter((x) => !x.deletedAt && !hasTemplates.has(x.id))) {
    out.artistsSeeded++;
    if (!opts.dryRun) await run(importCtx("migrate-checklists", ctx.runId, a.id), (w) => seedDefaultTemplates(w, a.id));
  }
  return out;
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await migrateChecklists(firestore(), { dryRun: flag("dry-run") });
  console.log(flag("dry-run") ? "Dry run (nothing written):" : "Migrated:");
  console.log(`  shows converted from legacy checklist/gear: ${r.showsConverted}`);
  console.log(`  lists touched: ${r.listsTouched}`);
  console.log(`  due dates stripped: ${r.dueStripped}`);
  console.log(`  rule templates retired: ${r.templatesRetired}`);
  console.log(`  artists seeded with Promo + Follow Up: ${r.artistsSeeded}`);
}

if (process.argv[1]?.endsWith("migrate-checklists.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
