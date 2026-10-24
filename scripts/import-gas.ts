/**
 * One-time import of a musician's gas-reimbursement sheet (Fuel Cost tab: one row per drive, round-trip miles x $/gal / mpg)
 * as their expenses, from the snapshot in .booking-kit/gas-eric.json (gitignored, public repo).
 *   tsx scripts/import-gas.ts [--dry-run] [--yes] [--artist=<slug>] [--report=<file.json>]
 * Each row becomes one travel expense for the musician named in the snapshot, to be paid back (Paid TRUE rows are reported,
 * not imported: the sheet has no paid-back date). A "Show" row is put on the show that day (matched as in
 * import-show-income.ts); rehearsals and other drives go on no show, since an expense can only point at a show.
 * Fixed ids (gas-<musicianId>-<date>), so a re-run updates an unpaid expense instead of adding a second one.
 * All writes go through db.ts with via "import" and one runId (Admin → History can undo it). Real Firestore needs --yes.
 */
import { writeFileSync } from "node:fs";
import { run, db, type Doc } from "../src/server/db";
import { importCtx, newRunId } from "../src/server/ctx";
import { refreshDealTotals } from "../src/server/dealTotals";
import { formatCents } from "../src/lib/money";
import { loadSnapshot, sheetDate, sheetCents, matchRows, showLabel } from "./import-show-income";

interface Drive { line: number; date: string; type: string; gig: string; address: string; roundTrip: number; perGallon: number; gallons: number; amount: number; paid: boolean }

export interface GasReport {
  project: string; dryRun: boolean; runId: string; source: string; musician: string; userId?: string; mpg: number;
  rows: {
    line: number; date: string; type: string; place: string; amount: number; expenseId: string; what: string;
    action?: "created" | "updated" | "unchanged" | "paid back, left" | "skipped";
    showId?: string; showLabel?: string; match?: string; rehearsalId?: string; issues: string[];
  }[];
  total: number;
}

export async function importGas(opts: { dryRun?: boolean; artist?: string } = {}): Promise<GasReport> {
  const snap = loadSnapshot("gas-eric.json") as ReturnType<typeof loadSnapshot> & { musician: string; mpg: number };
  const [head, ...body] = snap.values;
  const col = (r: string[], name: string) => (r[head.indexOf(name)] ?? "").trim();
  const drives: Drive[] = body.flatMap((r, i) => {
    const date = sheetDate(col(r, "Date"));
    return date ? [{
      line: i + 2, date, type: col(r, "Type"), gig: col(r, "Place"), address: col(r, "Address"),
      roundTrip: Number(col(r, "Round-trip mi")), perGallon: sheetCents(col(r, "Gas $/gal")), gallons: Number(col(r, "Gallons")),
      amount: sheetCents(col(r, "Fuel cost")), paid: col(r, "Paid").toUpperCase() === "TRUE",
    }] : [];
  });
  const runId = newRunId();
  const report: GasReport = { project: process.env.GCLOUD_PROJECT ?? "", dryRun: !!opts.dryRun, runId, source: snap.source, musician: snap.musician, mpg: snap.mpg, rows: [], total: 0 };

  const artists = await db.list("artists");
  const artist = opts.artist ? artists.find((a) => a.slug === opts.artist) : artists.length === 1 ? artists[0] : undefined;
  const musician = artist && (await db.list("musicians")).find((m) => (m.name as string).toLowerCase() === snap.musician.toLowerCase());
  const user = musician && (await db.list("users")).find((u) => u.musicianId === musician.id);
  report.userId = user?.id;
  const shows = artist ? await db.list("shows", (q) => q.where("artistId", "==", artist.id)) : [];
  const rehearsals = await db.list("rehearsals");
  const matches = matchRows(drives.filter((d) => d.type === "Show"), shows);
  const ctx = importCtx("import-gas", runId, artist?.id);

  // The same place should always be the same drive: flag a row whose address or miles differ from most rows for that place.
  const usual = (pick: (d: Drive) => string | number) => {
    const m = new Map<string, Map<string | number, number>>();
    for (const d of drives) { const c = m.get(d.gig) ?? new Map(); c.set(pick(d), (c.get(pick(d)) ?? 0) + 1); m.set(d.gig, c); }
    return (d: Drive) => [...m.get(d.gig)!].sort((a, b) => b[1] - a[1])[0][0];
  };
  const usualAddr = usual((d) => d.address), usualMiles = usual((d) => d.roundTrip);
  const n = new Map<string, number>();
  for (const d of drives) {
    const k = n.get(d.date) ?? 0; n.set(d.date, k + 1);
    const expenseId = `gas-${musician?.id ?? "unknown"}-${d.date}${k ? `-${k + 1}` : ""}`;
    const what = `Gas: ${d.type.toLowerCase()} at ${d.gig} (${d.roundTrip} mi round trip, ${d.gallons} gal at ${formatCents(d.perGallon)}/gal)`;
    const out: GasReport["rows"][number] = { line: d.line, date: d.date, type: d.type, place: d.gig, amount: d.amount, expenseId, what, issues: [] };
    report.rows.push(out);
    report.total += d.amount;

    const expect = Math.round((d.roundTrip / snap.mpg) * d.perGallon);
    if (Math.abs(expect - d.amount) > 1) out.issues.push(`${d.roundTrip} mi / ${snap.mpg} mpg x ${formatCents(d.perGallon)} = ${formatCents(expect)}, the sheet says ${formatCents(d.amount)}`);
    if (usualAddr(d) !== d.address) out.issues.push(`"${d.gig}" is ${usualAddr(d)} on the other rows; this row says ${d.address}`);
    if (usualMiles(d) !== d.roundTrip) out.issues.push(`"${d.gig}" is ${usualMiles(d)} mi on the other rows; this row says ${d.roundTrip}`);
    if (d.type === "Show") {
      const m = matches.find((x) => x.row === d);
      out.match = m?.how;
      if (m?.show) Object.assign(out, { showId: m.show.id, showLabel: showLabel(m.show) });
      else out.issues.push("no show found that day: goes on no show");
    } else {
      const r = rehearsals.find((x) => x.date === d.date && !x.deletedAt);
      if (r) out.rehearsalId = r.id;
      out.issues.push(d.type === "Rehearsal"
        ? `an expense can't point at a rehearsal${r ? ` (rehearsal ${r.id} is that day)` : " (and there's no rehearsal in the app that day)"}: goes on no show`
        : `a ${d.type.toLowerCase()} isn't a show: goes on no show`);
    }
    if (!user) { out.action = "skipped"; out.issues.push(`no user for musician "${snap.musician}"${artist ? "" : " (no artist in this project yet)"}`); continue; }
    if (d.paid) { out.action = "skipped"; out.issues.push("marked Paid: not imported (no paid-back date in the sheet)"); continue; }

    const input = { userId: user.id, date: d.date, amount: d.amount, category: "travel", what, payBack: true, ...(out.showId ? { showId: out.showId } : {}) };
    const have = await db.get("expenses", expenseId);
    if (have?.paidBackAt) { out.action = "paid back, left"; continue; }
    const same = have && !have.deletedAt && Object.entries(input).every(([k, v]) => have[k] === v) && (out.showId ?? null) === (have.showId ?? null);
    out.action = !have ? "created" : same ? "unchanged" : "updated";
    if (opts.dryRun || same) continue;
    await run(ctx, async (w) => {
      let made: Doc[] = [];
      if (!have) { await w.create("expenses", input, { id: expenseId }); made = [(await w.get("expenses", expenseId))!]; }
      else {
        if (have.deletedAt) await w.restore("expenses", expenseId);
        await w.update("expenses", expenseId, { ...input, showId: out.showId ?? null });
      }
      for (const id of new Set([out.showId, have?.showId as string | undefined].filter((x): x is string => !!x))) await refreshDealTotals(w, id, { expenses: made });
    });
  }
  return report;
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await importGas({ dryRun: flag("dry-run"), artist: arg("artist") });
  const c = (k: string) => r.rows.filter((x) => x.action === k).length;
  console.log(`${r.dryRun ? "Would import" : "Imported"} ${r.rows.length} drives (${formatCents(r.total)}) for ${r.musician} into ${r.project}, run ${r.runId}`);
  console.log(`  created ${c("created")}, updated ${c("updated")}, unchanged ${c("unchanged")}, skipped ${c("skipped")}; on a show ${r.rows.filter((x) => x.showId).length}`);
  for (const x of r.rows.filter((x) => x.issues.length)) console.log(`  line ${x.line} ${x.date} ${x.type} ${x.place}: ${x.issues.join("; ")}`);
  const out = arg("report");
  if (out) { writeFileSync(out, JSON.stringify(r, null, 2) + "\n"); console.log(`Report: ${out}`); }
}

if (process.argv[1]?.endsWith("import-gas.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
