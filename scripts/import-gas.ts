/**
 * One-time import of a musician's gas-reimbursement sheet (Fuel Cost tab: one row per drive, round-trip miles x $/gal / mpg)
 * as their expenses, from the snapshot in .booking-kit/gas-eric.json (gitignored, public repo).
 *   tsx scripts/import-gas.ts [--dry-run] [--yes] [--artist=<slug>] [--report=<file.json>]
 * The musician is resolved by `musicianEmail` first and the full name as a fallback: the sheet says a first name and the roster
 * says the full name, so a name-only match found nobody and skipped every row quietly. No match now fails the run.
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
import { formatSurvey, note, tally, type Bucket, type Note, type Survey } from "./survey";

interface Drive { line: number; date: string; type: string; gig: string; address: string; roundTrip: number; perGallon: number; gallons: number; amount: number; paid: boolean }

export interface GasReport {
  project: string; dryRun: boolean; runId: string; source: string; musician: string; musicianEmail?: string; userId?: string; mpg: number;
  /** Who the snapshot's musician resolved to, and how. The failure this import is prone to is a silent whole-file skip. */
  resolved?: { musicianId: string; musicianName: string; musicianEmail?: string; userId: string; userName?: string; userEmail?: string; how: "email" | "name" };
  rows: {
    line: number; date: string; type: string; place: string; amount: number; expenseId: string; what: string;
    action?: "created" | "updated" | "unchanged" | "paid back, left" | "skipped";
    showId?: string; showLabel?: string; match?: string; rehearsalId?: string; issues: string[];
  }[];
  total: number;
}

export type GasSnapshot = { source: string; values: string[][]; musician: string; musicianEmail?: string; mpg: number };

/**
 * Who the snapshot's musician is, by email first and the full name as a fallback.
 *
 * Email because it survives a rename and tells two people with one first name apart; the sheet has only a first name, while the roster
 * carries the full name, so the name match this used to rely on alone matched nothing and every row was skipped
 * quietly. A snapshot with no `musicianEmail` keeps the old behaviour.
 */
export function resolveMusician(
  snap: { musician: string; musicianEmail?: string },
  musicians: Doc[],
): { musician?: Doc; how: "email" | "name"; tried: string } {
  const wantEmail = snap.musicianEmail?.trim().toLowerCase();
  if (wantEmail) {
    const byEmail = musicians.find((m) => (m.email as string | undefined)?.trim().toLowerCase() === wantEmail);
    if (byEmail) return { musician: byEmail, how: "email", tried: wantEmail };
  }
  const byName = musicians.find((m) => (m.name as string).toLowerCase() === snap.musician.toLowerCase());
  return { musician: byName, how: wantEmail ? "email" : "name", tried: wantEmail ?? snap.musician };
}

export async function importGas(opts: { dryRun?: boolean; artist?: string; snapshot?: GasSnapshot } = {}): Promise<GasReport> {
  const snap = opts.snapshot ?? (loadSnapshot("gas-eric.json") as ReturnType<typeof loadSnapshot> & GasSnapshot);
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
  const report: GasReport = { project: process.env.GCLOUD_PROJECT ?? "", dryRun: !!opts.dryRun, runId, source: snap.source, musician: snap.musician, musicianEmail: snap.musicianEmail, mpg: snap.mpg, rows: [], total: 0 };

  const artists = await db.list("artists");
  const artist = opts.artist ? artists.find((a) => a.slug === opts.artist) : artists.length === 1 ? artists[0] : undefined;
  const found = artist ? resolveMusician(snap, await db.list("musicians")) : undefined;
  const musician = found?.musician;
  const user = musician && (await db.list("users")).find((u) => u.musicianId === musician.id);
  report.userId = user?.id;
  if (musician && user) {
    report.resolved = {
      musicianId: musician.id, musicianName: musician.name as string, musicianEmail: musician.email as string | undefined,
      userId: user.id, userName: user.name as string | undefined, userEmail: user.email as string | undefined, how: found!.how,
    };
  }
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
    if (!user) {
      out.action = "skipped";
      out.issues.push(musician
        ? `musician "${musician.name}" has no login, so the expense has no one to belong to`
        : `no musician matched ${snap.musicianEmail ? `email "${snap.musicianEmail}"` : `name "${snap.musician}"`}${artist ? "" : " (no artist in this project yet)"}`);
      continue;
    }
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

/**
 * The gas survey. It leads with who every row resolved to, by name and email: a whole file silently skipped because
 * the snapshot's musician matched nobody is the exact failure this import is prone to, so it is stated rather than
 * left to be inferred from thirteen identical row issues.
 */
export function gasSurvey(r: GasReport): Survey {
  const notes: Note[] = [];
  if (!r.resolved) {
    notes.push(note("unclean", "NO MUSICIAN RESOLVED: every row would be skipped and nothing would be imported",
      r.musician, `tried ${r.musician}${r.musicianEmail ? ` / ${r.musicianEmail}` : " (snapshot carries no musicianEmail)"}`));
  }
  for (const x of r.rows) {
    const where = `line ${x.line} ${x.date} ${x.type} ${x.place}`;
    for (const issue of x.issues) {
      // A Paid row and a non-show drive are both known, intended outcomes; the rest is either a judgement call or wrong.
      const bucket: Bucket = /marked Paid/.test(issue) ? "deferred"
        : /goes on no show/.test(issue) ? "deferred"
        : /no musician matched|has no login/.test(issue) ? "unclean"
        : "decide";
      // The row-specific parts (the parenthetical, amounts, and the addresses and mileages being compared) would
      // otherwise split one problem into one group per row, so they live in the detail and the reason stays general.
      const reason = issue
        .replace(/\s*\([^)]*\)/g, "")
        .replace(/ is .* on the other rows; this row says .*/, " doesn't match the other rows for that place")
        .replace(/-?\$[\d,.]+/g, "an amount")
        .replace(/\b\d+(\.\d+)? mi\b/g, "N mi")
        .trim();
      notes.push(note(bucket, reason, where, issue));
    }
    if (x.action === "updated") notes.push(note("overwrite", "an expense already there would be updated", where, x.expenseId));
    if (x.action === "paid back, left") notes.push(note("deferred", "already paid back, so it is left exactly as it is", where));
  }
  return {
    title: "Gas (Eric's drives)", project: r.project, dryRun: r.dryRun, runId: r.runId,
    source: `${r.rows.length} drives from ${r.source}`,
    clean: tally(r.rows.filter((x) => x.action).map((x) => ({ collection: "expenses", action: x.action! }))),
    notes,
    totals: {
      musician: r.resolved ? `${r.resolved.musicianName} <${r.resolved.musicianEmail ?? "no email"}> (by ${r.resolved.how})` : "NONE RESOLVED",
      login: r.resolved ? `${r.resolved.userName ?? r.resolved.userId} <${r.resolved.userEmail ?? "no email"}>` : "NONE",
      "total in the sheet": formatCents(r.total),
      "on a show": r.rows.filter((x) => x.showId).length,
    },
  };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await importGas({ dryRun: flag("dry-run"), artist: arg("artist") });
  console.log(formatSurvey(gasSurvey(r)));
  const out = arg("report");
  if (out) { writeFileSync(out, JSON.stringify({ ...r, survey: gasSurvey(r) }, null, 2) + "\n"); console.log(`Report: ${out}`); }
  // Nothing imported because nobody matched is a failed run, not a quiet success: exit non-zero so it can't slip past.
  if (!r.resolved && r.rows.length) {
    throw new Error(`No musician matched ${r.musicianEmail ? `"${r.musicianEmail}"` : `"${r.musician}"`}: all ${r.rows.length} drives were skipped and nothing was imported.`);
  }
}

if (process.argv[1]?.endsWith("import-gas.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
