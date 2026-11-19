/**
 * Tenancy phase 10: copy every artist record, with its sub-collections and History, from the top level (`shows/{id}`) to under its
 * artist (`artists/{artistId}/shows/{id}`). See the phase 10 design note (tenancy-plan/phase10-design.md) for the whole move.
 *
 *   npx tsx scripts/migrate-nested.ts                 dry run: what would be copied, per artist per kind, and every problem
 *   npx tsx scripts/migrate-nested.ts --apply         turn on read-only (platform/config.readOnly), copy, then verify
 *   npx tsx scripts/migrate-nested.ts --verify        compare the two copies only (counts per kind per artist, and every doc)
 *   npx tsx scripts/migrate-nested.ts --reverse [--apply]   rollback: copy the nested records back to the top level (writes made
 *                                                     after the flip exist only there)
 *
 * What it does:
 * - Only kinds that move (`movesUnderArtist`, src/schema/owners.ts): every artist kind except mcpTokens, shortcutTokens, invites and
 *   assistantThreads. Shared, person and server data never move.
 * - Copies documents exactly: same ids, data, revs and timestamps (createdAt, updatedAt, deletedAt). Soft-deleted records too.
 * - A record goes under its own `artistId`. Its sub-collections (comments, activity, entries, tracks) and History go with it.
 * - History paths: each entry's `entity` must name its record by the record's logical path (`{kind: "shows", id}`, never a stored
 *   path). An entry that names anything else is rewritten to it (counted as "History paths rewritten").
 * - Adds the link index (`artistLinks/{kind}_{id}`, src/server/links.ts) for every availability ask and stage plot, so public links
 *   sent before phase 4 (which carry no artist) still open.
 * - Verifies: the same documents on both sides, kind by kind and artist by artist, with identical data.
 *
 * Problems (a record with no artistId, an unknown artist, a sub-record whose own artistId differs from its record's) are listed in
 * the dry run, and `--apply` refuses while there are any. Safe to run again: a doc already copied identically is skipped.
 * Read-only stays ON after --apply: flip with `platform-config.ts nested on`, then `platform-config.ts read-only off`.
 * Against the emulator set FIRESTORE_EMULATOR_HOST; against prod GCLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS.
 */
import type { DocumentData, Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { encode, walkDocs } from "@/server/backup";
import { LINKED_KINDS, linkPath } from "@/server/links";
import { PLATFORM_CONFIG_DOC } from "@/server/signUpFlag";
import { movesUnderArtist, splitPath } from "@/schema/owners";

export type Direction = "nest" | "flatten";

export interface Problem { path: string; why: string }
export interface NestReport {
  direction: Direction;
  apply: boolean;
  /** Per artist, per collection pattern ("shows", "shows/history", "pitches/comments"): documents found on the source side. */
  counts: Record<string, Record<string, number>>;
  copied: number;
  alreadyThere: number;
  historyRewritten: number;
  links: number;
  problems: Problem[];
  /** After a copy (or with --verify): what differs between the two sides. Empty = verified. */
  mismatches: string[];
  verified: boolean;
}

/** "shows/s1/history/000001" → "shows/history": the collection names along a logical path. */
export const patternOf = (logicalDocPath: string) => logicalDocPath.split("/").filter((_, i) => i % 2 === 0).join("/");

interface Row { logical: string; artistId: string | null; data: DocumentData }

/** Every document of the moving kinds on one side, by logical path, with the artist it belongs under. */
async function side(fs: Firestore, nested: boolean, problems?: Problem[]): Promise<Map<string, Row>> {
  const tops = (await fs.listCollections()).map((c) => c.id);
  const keep = nested ? new Set(["artists"]) : new Set(tops.filter(movesUnderArtist));
  const walked = await walkDocs(fs, { skip: new Set(tops.filter((t) => !keep.has(t))) });
  const docs: QueryDocumentSnapshot[] = Object.values(walked).flat();
  const rows = new Map<string, Row>();
  if (nested) {
    for (const d of docs) {
      const { logical, artistId } = splitPath(d.ref.path);
      if (!artistId) continue; // the artist's own doc, its History, or a kind that doesn't move
      rows.set(logical, { logical, artistId, data: d.data() });
    }
    return rows;
  }
  const own = new Map<string, string | null>();
  for (const d of docs) if (d.ref.path.split("/").length === 2) own.set(d.ref.path, typeof d.get("artistId") === "string" && d.get("artistId") ? d.get("artistId") : null);
  for (const d of docs) {
    const s = d.ref.path.split("/");
    const top = `${s[0]}/${s[1]}`;
    const mine = typeof d.get("artistId") === "string" && d.get("artistId") ? (d.get("artistId") as string) : null;
    // A sub-record and a History entry go where their record goes; a record whose parent is gone, by its own artistId.
    const artistId = own.has(top) ? own.get(top)! : mine;
    if (!artistId) problems?.push({ path: d.ref.path, why: own.has(top) ? "its record has no artistId" : "no artistId (and its record is gone)" });
    else if (s.length > 2 && mine && mine !== artistId && s[s.length - 2] !== "history") problems?.push({ path: d.ref.path, why: `artistId ${mine}, but its record is ${artistId}'s` });
    rows.set(d.ref.path, { logical: d.ref.path, artistId, data: d.data() });
  }
  return rows;
}

/** A History entry names its record by the record's logical path; anything else is rewritten (true when it was). */
function fixHistory(logical: string, data: DocumentData): { data: DocumentData; rewritten: boolean } {
  const s = logical.split("/");
  if (s.length < 4 || s[s.length - 2] !== "history") return { data, rewritten: false };
  const kind = s.slice(0, -3).join("/"), id = s[s.length - 3];
  if (data.entity?.kind === kind && data.entity?.id === id) return { data, rewritten: false };
  return { data: { ...data, entity: { ...(data.entity ?? {}), kind, id } }, rewritten: true };
}

const same = (a: DocumentData, b: DocumentData) => JSON.stringify(encode(a)) === JSON.stringify(encode(b));
const target = (r: Row, direction: Direction) => (direction === "nest" ? `artists/${r.artistId}/${r.logical}` : r.logical);

/** Compare both sides: every source document is on the target side with the same data (History entries after their path fix). */
async function compare(fs: Firestore, direction: Direction): Promise<string[]> {
  const src = await side(fs, direction === "flatten"), dst = await side(fs, direction === "nest");
  const out: string[] = [];
  const count = (rows: Map<string, Row>) => {
    const c = new Map<string, number>();
    for (const r of rows.values()) if (r.artistId) c.set(`${r.artistId}\t${patternOf(r.logical)}`, (c.get(`${r.artistId}\t${patternOf(r.logical)}`) ?? 0) + 1);
    return c;
  };
  const cs = count(src), cd = count(dst);
  for (const k of new Set([...cs.keys(), ...cd.keys()])) {
    if ((cs.get(k) ?? 0) !== (cd.get(k) ?? 0)) out.push(`count ${k.replace("\t", " ")}: ${cs.get(k) ?? 0} before, ${cd.get(k) ?? 0} after`);
  }
  for (const r of src.values()) {
    if (!r.artistId) continue;
    const d = dst.get(r.logical);
    if (!d) { out.push(`missing ${target(r, direction)}`); continue; }
    if (d.artistId !== r.artistId) { out.push(`${r.logical}: under ${d.artistId}, expected ${r.artistId}`); continue; }
    if (!same(fixHistory(r.logical, r.data).data, d.data)) out.push(`differs ${target(r, direction)}`);
  }
  return out;
}

/** How long servers may still be on their cached layout after read-only is turned on (src/server/layout.ts reads it every 5 s). */
export const SETTLE_MS = 10_000;

export async function migrateNested(opts: { apply: boolean; direction?: Direction; verifyOnly?: boolean; setReadOnly?: boolean; settleMs?: number } = { apply: false }): Promise<NestReport> {
  const fs = firestore();
  const direction = opts.direction ?? "nest";
  const problems: Problem[] = [];
  const report: NestReport = { direction, apply: opts.apply, counts: {}, copied: 0, alreadyThere: 0, historyRewritten: 0, links: 0, problems, mismatches: [], verified: false };
  if (opts.verifyOnly) {
    report.mismatches = await compare(fs, direction);
    report.verified = report.mismatches.length === 0;
    return report;
  }
  const src = await side(fs, direction === "flatten", problems);
  for (const r of src.values()) {
    if (!r.artistId) continue;
    const p = patternOf(r.logical);
    (report.counts[r.artistId] ??= {})[p] = (report.counts[r.artistId][p] ?? 0) + 1;
  }
  if (direction === "nest") {
    const artists = new Set((await fs.collection("artists").get()).docs.map((d) => d.id));
    for (const a of Object.keys(report.counts)) if (!artists.has(a)) problems.push({ path: `artists/${a}`, why: `${Object.values(report.counts[a]).reduce((n, x) => n + x, 0)} record(s) name an artist that doesn't exist` });
  }
  if (!opts.apply || problems.length) {
    for (const r of src.values()) if (fixHistory(r.logical, r.data).rewritten) report.historyRewritten++;
    return report;
  }

  if (opts.setReadOnly !== false) {
    await fs.doc(PLATFORM_CONFIG_DOC).set({ readOnly: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    // Every server has seen it (and any write it started before has committed) before the copy reads anything.
    await new Promise((r) => setTimeout(r, opts.settleMs ?? SETTLE_MS));
  }
  const dstNow = await side(fs, direction === "nest");
  const writer = fs.bulkWriter();
  writer.onWriteError((e) => e.failedAttempts < 5);
  for (const r of src.values()) {
    if (!r.artistId) continue;
    const { data, rewritten } = fixHistory(r.logical, r.data);
    if (rewritten) report.historyRewritten++;
    const there = dstNow.get(r.logical);
    if (there && there.artistId === r.artistId && same(there.data, data)) { report.alreadyThere++; continue; }
    void writer.set(fs.doc(target(r, direction)), data);
    report.copied++;
    const s = r.logical.split("/");
    if (s.length === 2 && LINKED_KINDS.has(s[0])) { void writer.set(fs.doc(linkPath(s[0], s[1])), { kind: s[0], id: s[1], artistId: r.artistId }); report.links++; }
  }
  // Links for records already copied by an earlier run, too.
  for (const r of src.values()) {
    const s = r.logical.split("/");
    if (!r.artistId || s.length !== 2 || !LINKED_KINDS.has(s[0]) || !dstNow.has(r.logical)) continue;
    void writer.set(fs.doc(linkPath(s[0], s[1])), { kind: s[0], id: s[1], artistId: r.artistId });
    report.links++;
  }
  await writer.close();
  report.mismatches = await compare(fs, direction);
  report.verified = report.mismatches.length === 0;
  return report;
}

export function formatNestReport(r: NestReport): string {
  const lines: string[] = [];
  const arrow = r.direction === "nest" ? "top level → artists/{id}/…" : "artists/{id}/… → top level";
  lines.push(`${arrow}${r.apply ? "" : " (dry run)"}`);
  for (const [a, byKind] of Object.entries(r.counts).sort()) {
    const total = Object.values(byKind).reduce((n, x) => n + x, 0);
    lines.push(`  ${a}: ${total} document(s)`);
    for (const [k, n] of Object.entries(byKind).sort()) lines.push(`    ${k.padEnd(28)} ${n}`);
  }
  if (r.problems.length) {
    lines.push(`${r.problems.length} problem(s)${r.apply ? ": nothing was copied" : ""}:`);
    for (const p of r.problems.slice(0, 50)) lines.push(`  ${p.path}: ${p.why}`);
  }
  lines.push(`History paths ${r.apply ? "rewritten" : "to rewrite"}: ${r.historyRewritten}`);
  if (r.apply && !r.problems.length) {
    lines.push(`Copied ${r.copied}, already there ${r.alreadyThere}, link index entries ${r.links}.`);
  }
  if (r.apply || r.mismatches.length || r.verified) {
    lines.push(r.verified ? "Verified: every document is on both sides, identical, with the same counts per kind per artist." : `${r.mismatches.length} mismatch(es):`);
    for (const m of r.mismatches.slice(0, 50)) lines.push(`  ${m}`);
  }
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply"), verifyOnly = argv.includes("--verify");
  const direction: Direction = argv.includes("--reverse") ? "flatten" : "nest";
  const project = process.env.GCLOUD_PROJECT, emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (!project && !emulator) throw new Error("No target: set GCLOUD_PROJECT (real Firestore) or FIRESTORE_EMULATOR_HOST (emulator). Refusing to guess.");
  console.log(`Target: ${project ?? "demo-band-tracker"} (${emulator ? `emulator at ${emulator}` : "REAL Firestore"})`);
  const r = await migrateNested({ apply, direction, verifyOnly });
  console.log(formatNestReport(r));
  if (r.problems.length && apply) process.exit(2);
  if ((apply || verifyOnly) && !r.verified) process.exit(3);
  if (apply) {
    console.log(direction === "nest"
      ? "Read-only is ON. Next: platform-config.ts nested on, then platform-config.ts read-only off."
      : "Read-only is ON. Next: platform-config.ts nested off, then platform-config.ts read-only off.");
  } else if (!verifyOnly) console.log("(dry run, nothing changed; re-run with --apply)");
}

if (process.argv[1]?.endsWith("migrate-nested.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
