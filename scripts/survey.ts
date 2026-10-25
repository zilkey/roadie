/**
 * The survey: what an import would do, as a list Jeff reads and signs off on BEFORE the real run.
 *
 * Every importer's --dry-run builds one of these and prints it. The importers already collect the facts (per-row
 * `issues`, an `action`, the matchKey dedupe, `warnings`); this turns them into the five questions a survey answers:
 *
 *   clean      what lands cleanly, counted by collection and action
 *   unclean    what doesn't, and why -- grouped by reason, so a hundred rows of one problem read as one line
 *   overwrite  existing values the import would replace (a re-run, or after a hand edit)
 *   decide     ambiguous matches, near-duplicates, missing required fields, anything guessed at: Jeff's list
 *   deferred   columns and tabs this import knowingly doesn't carry, so nothing looks lost later
 *
 * An empty `unclean` and `decide` is the signal the production run is safe. "Clean" is not "no issues": a row that
 * lands exactly as intended and says so is clean, which is why each importer decides its own buckets rather than
 * this file guessing from the word "issue".
 */

export type Bucket = "unclean" | "overwrite" | "decide" | "deferred";

/** One thing worth saying about one row. `reason` is the grouping key, so keep it free of row-specific detail. */
export interface Note {
  bucket: Bucket;
  /** The grouped headline ("no show found that day"), identical for every row with the same problem. */
  reason: string;
  /** This row, for the indented detail under the group ("line 12 2026-10-03 Denver Porchfest"). */
  where?: string;
  /** Anything row-specific that doesn't belong in the grouping key. */
  detail?: string;
}

export interface Survey {
  /** The import, as it is named to a person: "Booking kit". */
  title: string;
  project: string;
  dryRun: boolean;
  runId?: string;
  /** "3 trackers: 41 venues, 62 shows" -- what was read, before anything about what it would do. */
  source?: string;
  /** What lands cleanly: "venues" -> {created: 12, unchanged: 3}. */
  clean: Record<string, Record<string, number>>;
  notes: Note[];
  /** Printed last, under their own heading: the counts a person checks at a glance. */
  totals?: Record<string, string | number>;
}

export const note = (bucket: Bucket, reason: string, where?: string, detail?: string): Note => ({ bucket, reason, where, detail });

/** `clean` from rows that each name a collection and an action. */
export function tally(rows: { collection: string; action: string }[]): Survey["clean"] {
  const out: Survey["clean"] = {};
  for (const r of rows) {
    out[r.collection] ??= {};
    out[r.collection][r.action] = (out[r.collection][r.action] ?? 0) + 1;
  }
  return out;
}

const HEADINGS: Record<Bucket, string> = {
  decide: "Needs a decision",
  unclean: "Won't land cleanly",
  overwrite: "Would overwrite",
  deferred: "Deferred on purpose",
};
/** Jeff's list first: the survey is read top down and this is the part that is actually read. */
const ORDER: Bucket[] = ["decide", "unclean", "overwrite", "deferred"];

/** Rows of one bucket, grouped by reason, biggest group first; ties keep the order they were reported in. */
export function group(notes: Note[], bucket: Bucket): { reason: string; rows: Note[] }[] {
  const by = new Map<string, Note[]>();
  for (const n of notes.filter((x) => x.bucket === bucket)) by.set(n.reason, [...(by.get(n.reason) ?? []), n]);
  return [...by.entries()].map(([reason, rows]) => ({ reason, rows })).sort((a, b) => b.rows.length - a.rows.length);
}

/** At most `limit` rows of detail per group: a hundred of the same problem is a count, not a hundred lines. */
const DETAIL_LIMIT = 12;

/**
 * The survey as text for stdout. The shape is fixed so the four surveys read alike at 1am:
 * target, what was read, what lands, then the four buckets with "Needs a decision" at the top.
 */
export function formatSurvey(s: Survey, opts: { detailLimit?: number } = {}): string {
  const limit = opts.detailLimit ?? DETAIL_LIMIT;
  const out: string[] = [];
  out.push(`${s.title} survey -- ${s.dryRun ? "dry run, nothing written" : "AFTER THE RUN"}`);
  out.push(`  Target: ${s.project || "(no GCLOUD_PROJECT)"}${s.runId ? `, run ${s.runId}` : ""}`);
  if (s.source) out.push(`  Read: ${s.source}`);

  const collections = Object.keys(s.clean).sort();
  out.push("", `What lands clean${collections.length ? "" : ": nothing"}`);
  for (const c of collections) {
    const actions = Object.entries(s.clean[c]).sort(([a], [b]) => a.localeCompare(b));
    const n = actions.reduce((t, [, v]) => t + v, 0);
    out.push(`  ${c}: ${n} (${actions.map(([k, v]) => `${k} ${v}`).join(", ")})`);
  }

  for (const b of ORDER) {
    const groups = group(s.notes, b);
    const n = groups.reduce((t, g) => t + g.rows.length, 0);
    out.push("", `${HEADINGS[b]}${n ? ` (${n})` : ": none"}`);
    for (const g of groups) {
      out.push(`  ${g.reason} -- ${g.rows.length}`);
      for (const r of g.rows.slice(0, limit)) {
        if (r.where || r.detail) out.push(`    ${[r.where, r.detail].filter(Boolean).join(": ")}`);
      }
      if (g.rows.length > limit) out.push(`    ... and ${g.rows.length - limit} more`);
    }
  }

  if (s.totals && Object.keys(s.totals).length) {
    out.push("", "Totals");
    for (const [k, v] of Object.entries(s.totals)) out.push(`  ${k}: ${v}`);
  }

  const blocking = s.notes.filter((n) => n.bucket === "unclean" || n.bucket === "decide").length;
  out.push("", blocking
    ? `${blocking} thing(s) to read before the real run.`
    : "Nothing unclean and nothing to decide: safe to run.");
  return out.join("\n");
}
