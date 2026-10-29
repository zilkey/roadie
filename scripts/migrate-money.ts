/**
 * Money moves off the show's deal into projects, income and payouts (#39):
 *   npm run migrate:money -- [--dry-run] [--yes]
 * Per artist:
 *   - a Band project (kind "band", the default) and a Duo project (kind "duo") are created if the artist has none; every
 *     configuration without a defaultProjectId gets one: a name containing "duo" -> Duo, everything else -> Band
 *   - every show without a projectId gets its billedAs configuration's project, else Band
 *   - every expense without a projectId gets its show's project, else Band; a legacy income-type category
 *     (guarantee, door, merch, tips, venmo) is rewritten to "other" and reported
 *   - every showDeals.income[] line with an amount becomes an income doc (date = the show's, receivedAt = the show's date when
 *     the line was received, from = the venue, sourceKey `${showId}:${line.id}`). The deal's income[] is left in place as LEGACY
 *     data, and the deal's totals are refreshed, so every show's net is unchanged.
 * Live docs go through the normal writer (history + rev, via "import") under one runId, so Admin → History can undo the run.
 * Safe to run again: projects and defaults are matched, projectIds are only set where missing, and a line whose sourceKey
 * already has a live income doc is skipped. --dry-run walks the real data through the writer's overlay (so later steps see
 * the projects the earlier ones would create) and prints the same survey, writing nothing.
 * Soft-deleted shows and expenses are left alone. Against real Firestore (no emulator host) it needs --yes.
 */
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { run, type Doc } from "@/server/db";
import { refreshDealTotals } from "@/server/dealTotals";
import { incomeCategory, paymentMethod } from "@/schema/common";
import { formatCents } from "@/lib/money";
import { formatSurvey, note, tally, type Note, type Survey } from "./survey";

const LEGACY_INCOME_CATEGORIES = new Set(["guarantee", "door", "merch", "tips", "venmo"]);

export interface MigrateMoneyResult {
  runId: string;
  dryRun: boolean;
  projectsCreated: { artistId: string; kind: string; name: string }[];
  configurationsSet: number;
  showsSet: number;
  expensesSet: number;
  expensesRewritten: { id: string; was: string }[];
  incomeCreated: { id: string; showId: string; sourceKey: string; amount: number; received: boolean }[];
  incomeSkipped: { sourceKey: string; why: "already migrated" | "zero amount" }[];
  notes: Note[];
  /** Per artist and show with income lines: the deal's legacy lines and the income docs now carrying them. */
  nets: { showId: string; legacy: number; income: number }[];
}

interface Line { id: string; category: string; amount: number; method?: string; received?: boolean }

export async function migrateMoney(fs: Firestore, opts: { dryRun?: boolean } = {}): Promise<MigrateMoneyResult> {
  const base = importCtx("migrate-money");
  const dryRun = !!opts.dryRun;
  // ONE overlay for the whole dry run: a later unit reads what an earlier one would have written.
  const overlay = new Map<string, DocumentData | null>();
  const unit = <T>(artistId: string, fn: Parameters<typeof run<T>>[1]) => run({ ...base, artistId }, fn, dryRun ? { dryRun: true, overlay } : {});
  const out: MigrateMoneyResult = {
    runId: base.runId, dryRun, projectsCreated: [], configurationsSet: 0, showsSet: 0, expensesSet: 0, expensesRewritten: [],
    incomeCreated: [], incomeSkipped: [], notes: [], nets: [],
  };

  const live = async (name: string) => (await fs.collection(name).get()).docs.map((d) => ({ ...d.data(), id: d.id }) as Doc).filter((d) => !d.deletedAt);
  const artists = (await fs.collection("artists").get()).docs.map((d) => ({ ...d.data(), id: d.id }) as Doc).filter((a) => !a.deletedAt);
  const shows = await live("shows");
  const expenses = await live("expenses");
  const users = new Map((await fs.collection("users").get()).docs.map((d) => [d.id, d.data()]));
  const showProject = new Map<string, string>();
  const showArtist = new Map(shows.map((s) => [s.id, s.artistId as string]));

  for (const artist of artists) {
    const aid = artist.id;
    const label = String(artist.name ?? aid);
    const configs = (artist.configurations ?? []) as { id: string; name: string; defaultProjectId?: string }[];
    const isDuo = (c: { name: string }) => /duo/i.test(c.name);

    // ---- unit 1: the projects and the configurations' defaults ----
    const setup = await unit(aid, async (w) => {
      const mine = (await w.query("projects", (q) => q.where("artistId", "==", aid), { pending: true })).filter((p) => p.artistId === aid);
      const find = (kind: string) => mine.find((p) => p.kind === kind && (kind !== "band" || p.isDefault)) ?? mine.find((p) => p.kind === kind);
      const ensure = async (kind: "band" | "duo", name: string, extra: Record<string, unknown>) => {
        const have = find(kind);
        if (have) return have.id;
        const r = await w.create("projects", { artistId: aid, kind, name, status: "open", ...extra });
        out.projectsCreated.push({ artistId: aid, kind, name });
        return r.id;
      };
      const bandId = await ensure("band", "Band", { isDefault: true });
      const duoId = await ensure("duo", configs.find(isDuo)?.name ?? "Duo", {});
      const next = configs.map((c) => (c.defaultProjectId ? c : { ...c, defaultProjectId: isDuo(c) ? duoId : bandId }));
      const changed = next.filter((c, i) => c !== configs[i]).length;
      if (changed) {
        await w.update("artists", aid, { configurations: next });
        out.configurationsSet += changed;
      }
      return { bandId, duoId, byConfig: new Map(next.map((c) => [c.id, c.defaultProjectId as string])) };
    });

    // ---- units 2..n: one per show ----
    for (const s of shows.filter((x) => x.artistId === aid)) {
      const where = `${label}: ${s.date} ${(s.venue as { name?: string } | undefined)?.name ?? s.hostName ?? s.editionName ?? s.id}`;
      const cfgProject = s.billedAs ? setup.byConfig.get(s.billedAs as string) : undefined;
      if (s.billedAs && !cfgProject) out.notes.push(note("unclean", "the show is billed as a configuration that does not exist, so its money goes to Band", where, `billedAs ${s.billedAs}`));
      const unitResult = await unit(aid, async (w) => {
        const cur = (await w.get("shows", s.id))!;
        const projectId = (cur.projectId as string | undefined) ?? cfgProject ?? setup.bandId;
        if (!cur.projectId) {
          await w.update("shows", s.id, { projectId });
          out.showsSet++;
        }
        const deal = await w.get("showDeals", s.id);
        const lines = deal && !deal.deletedAt ? ((deal.income ?? []) as Line[]) : [];
        const made: Doc[] = [];
        let legacy = 0, have = 0;
        for (const line of lines) {
          const sourceKey = `${s.id}:${line.id}`;
          if (!(line.amount > 0)) {
            out.incomeSkipped.push({ sourceKey, why: "zero amount" });
            out.notes.push(note("unclean", "a deal income line with no amount was not copied", where, `${line.category} line "${line.id}"`));
            continue;
          }
          legacy += line.amount;
          const existing = (await w.query("income", (q) => q.where("sourceKey", "==", sourceKey), { pending: true })).filter((d) => d.sourceKey === sourceKey);
          if (existing.length) {
            have += existing[0].amount as number;
            out.incomeSkipped.push({ sourceKey, why: "already migrated" });
            continue;
          }
          const known = incomeCategory.safeParse(line.category).success;
          if (!known) out.notes.push(note("unclean", "a deal income line has a category income does not know, so it became other", where, `"${line.category}" ${formatCents(line.amount)}`));
          const method = paymentMethod.safeParse(line.method).success ? line.method : undefined;
          if (line.method && !method) out.notes.push(note("unclean", "a deal income line has a payment method income does not know, so the method was dropped", where, `"${line.method}"`));
          const from = (cur.venue as { name?: string } | undefined)?.name ?? (cur.hostName as string | undefined) ?? (cur.editionName as string | undefined) ?? "Show";
          const r = await w.create("income", {
            artistId: aid, date: cur.date, amount: line.amount, category: known ? line.category : "other", ...(method ? { method } : {}), from,
            projectId, showId: s.id, ...(line.received ? { receivedAt: cur.date } : {}), sourceKey,
          });
          made.push((await w.get("income", r.id))!);
          have += line.amount;
          out.incomeCreated.push({ id: r.id, showId: s.id, sourceKey, amount: line.amount, received: !!line.received });
        }
        if (made.length) await refreshDealTotals(w, s.id, { income: made });
        return { projectId, legacy, have, lines: lines.length };
      });
      showProject.set(s.id, unitResult.projectId);
      if (unitResult.lines) out.nets.push({ showId: s.id, legacy: unitResult.legacy, income: unitResult.have });
    }

    // ---- expenses: the artist is the show's, else the payer's (first) band ----
    const artistOf = (e: Doc) => {
      if (e.showId && showArtist.has(e.showId as string)) return showArtist.get(e.showId as string)!;
      const ms = ((users.get(e.userId as string)?.artists ?? []) as { artistId: string }[]).map((m) => m.artistId);
      return ms.includes(aid) ? aid : ms[0];
    };
    for (const e of expenses) {
      if (artistOf(e) !== aid) continue;
      const legacyCat = LEGACY_INCOME_CATEGORIES.has(e.category as string);
      if (e.projectId && !legacyCat) continue;
      const where = `${label}: ${e.date} ${e.what} ${formatCents(e.amount as number)}`;
      const ms = (users.get(e.userId as string)?.artists ?? []) as unknown[];
      if (!e.showId && ms.length > 1) out.notes.push(note("decide", "an expense with no show belongs to a person in several bands, so it went to this band's Band project", where));
      await unit(aid, async (w) => {
        const cur = (await w.get("expenses", e.id))!;
        const patch: Record<string, unknown> = {};
        if (!cur.projectId) patch.projectId = (cur.showId ? showProject.get(cur.showId as string) : undefined) ?? setup.bandId;
        if (LEGACY_INCOME_CATEGORIES.has(cur.category as string)) {
          patch.category = "other";
          out.expensesRewritten.push({ id: e.id, was: cur.category as string });
          out.notes.push(note("unclean", "an expense carried an income category, so it became other", where, `was "${cur.category}"`));
        }
        if (!Object.keys(patch).length) return;
        await w.update("expenses", e.id, patch);
        if (patch.projectId) out.expensesSet++;
      });
    }
  }
  return out;
}

/** The survey Jeff reads before the real run: what lands cleanly, what will not, and the counts. */
export function moneySurvey(r: MigrateMoneyResult): Survey {
  const offNet = r.nets.filter((n) => n.legacy !== n.income);
  const notes = [...r.notes];
  for (const n of offNet) notes.push(note("unclean", "a show's income docs do not add up to its deal's income lines", n.showId, `lines ${formatCents(n.legacy)}, income ${formatCents(n.income)}`));
  return {
    title: "Money migration", project: process.env.GCLOUD_PROJECT ?? "", dryRun: r.dryRun, runId: r.runId,
    source: `${r.nets.length} shows with income lines`,
    clean: tally([
      ...r.projectsCreated.map(() => ({ collection: "projects", action: "created" })),
      ...(r.configurationsSet ? [{ collection: "configurations defaultProjectId", action: "set" }] : []),
      ...Array.from({ length: r.showsSet }, () => ({ collection: "shows projectId", action: "set" })),
      ...Array.from({ length: r.expensesSet }, () => ({ collection: "expenses projectId", action: "set" })),
      ...r.incomeCreated.map((i) => ({ collection: "income", action: i.received ? "created received" : "created owed" })),
      ...r.incomeSkipped.filter((i) => i.why === "already migrated").map(() => ({ collection: "income", action: "already there" })),
    ]),
    notes,
    totals: {
      "income to create": formatCents(r.incomeCreated.reduce((t, i) => t + i.amount, 0)),
      "of which owed (no receivedAt)": formatCents(r.incomeCreated.filter((i) => !i.received).reduce((t, i) => t + i.amount, 0)),
      "expenses rewritten from an income category": r.expensesRewritten.length,
      "lines skipped for no amount": r.incomeSkipped.filter((i) => i.why === "zero amount").length,
    },
  };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await migrateMoney(firestore(), { dryRun: flag("dry-run") });
  console.log(formatSurvey(moneySurvey(r)));
  if (!r.dryRun) console.log(`\nRun ${r.runId} -- undo it from Admin → History.`);
}

if (process.argv[1]?.endsWith("migrate-money.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
