/**
 * Tenancy phase 10, last step (a week after the flip): delete the top-level copies of artist records that scripts/migrate-nested.ts
 * copied under their artist (`shows/{id}` once `artists/{a}/shows/{id}` is the live one). After this the rollback is
 * `migrate-nested.ts --reverse --apply` (copy back) instead of just flipping the flag.
 *
 *   npx tsx scripts/delete-flat-copies.ts            dry run: what would be deleted, per kind, and what would be kept and why
 *   npx tsx scripts/delete-flat-copies.ts --apply    delete them (each record with its sub-collections and History)
 *
 * Refuses unless platform/config.nestedPaths is on (the nested copies are the live ones). A top-level record is deleted only when
 * it and every document under it has a nested copy that is at least as new (its `updatedAt` and `rev` no later): one changed or
 * created on the top level after the copy (a write that reached the old layout) is kept, with its sub-collections, and listed. Kinds that stay top level (mcpTokens, shortcutTokens, invites,
 * assistantThreads), shared, person and server data are never touched.
 */
import type { DocumentData, Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { walkDocs } from "@/server/backup";
import { PLATFORM_CONFIG_DOC } from "@/server/signUpFlag";
import { movesUnderArtist } from "@/schema/owners";
import { patternOf } from "./migrate-nested";

export interface DeleteReport { apply: boolean; deleted: Record<string, number>; kept: { path: string; why: string }[] }

const millis = (v: unknown) => (v && typeof (v as { toMillis?: () => number }).toMillis === "function" ? (v as { toMillis: () => number }).toMillis() : 0);
/** The top-level copy has nothing the nested one lacks: no later change (updatedAt), no higher rev. */
const notNewer = (flat: DocumentData, nested: DocumentData) =>
  millis(flat.updatedAt) <= millis(nested.updatedAt) && Number(flat.rev ?? 0) <= Number(nested.rev ?? 0);

export async function deleteFlatCopies({ apply, fs = firestore() }: { apply: boolean; fs?: Firestore }): Promise<DeleteReport> {
  const cfg = (await fs.doc(PLATFORM_CONFIG_DOC).get()).data();
  if (cfg?.nestedPaths !== true) throw new Error("platform/config.nestedPaths is off: the top-level copies are the live ones. Refusing.");
  const tops = (await fs.listCollections()).map((c) => c.id);
  const walked = await walkDocs(fs, { skip: new Set(tops.filter((t) => !movesUnderArtist(t))) });
  const docs: QueryDocumentSnapshot[] = Object.values(walked).flat();
  const artistOf = new Map<string, string | undefined>();
  for (const d of docs) if (d.ref.path.split("/").length === 2) artistOf.set(d.ref.path, d.get("artistId") as string | undefined);
  const report: DeleteReport = { apply, deleted: {}, kept: [] };
  // A record goes (with everything under it) only when it and every document under it has an identical nested copy.
  const blocked = new Set<string>();
  const checks = await Promise.all(docs.map(async (d) => {
    const s = d.ref.path.split("/");
    const top = `${s[0]}/${s[1]}`;
    const a = artistOf.get(top) ?? (d.get("artistId") as string | undefined);
    if (!a) return { d, top, why: "no artist to look under" };
    const copy = await fs.doc(`artists/${a}/${d.ref.path}`).get();
    if (!copy.exists) return { d, top, why: "no nested copy" };
    return notNewer(d.data(), copy.data()!) ? { d, top, why: null } : { d, top, why: "changed here after the copy (newer than the nested one)" };
  }));
  for (const c of checks) if (c.why) { blocked.add(c.top); report.kept.push({ path: c.d.ref.path, why: c.why }); }
  for (const d of docs) {
    const s = d.ref.path.split("/");
    if (s.length !== 2 || blocked.has(d.ref.path)) continue;
    const p = patternOf(d.ref.path);
    report.deleted[p] = (report.deleted[p] ?? 0) + 1;
    if (apply) await fs.recursiveDelete(d.ref);
  }
  // A sub-collection whose record doc is gone (walked into, never returned as a top doc): its children were checked above.
  for (const top of new Set(docs.map((d) => d.ref.path.split("/").slice(0, 2).join("/")))) {
    if (artistOf.has(top) || blocked.has(top)) continue;
    report.deleted[`${patternOf(top)} (orphaned sub-collections)`] = (report.deleted[`${patternOf(top)} (orphaned sub-collections)`] ?? 0) + 1;
    if (apply) await fs.recursiveDelete(fs.doc(top));
  }
  return report;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const project = process.env.GCLOUD_PROJECT, emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (!project && !emulator) throw new Error("No target: set GCLOUD_PROJECT (real Firestore) or FIRESTORE_EMULATOR_HOST (emulator). Refusing to guess.");
  console.log(`Target: ${project ?? "demo-band-tracker"} (${emulator ? `emulator at ${emulator}` : "REAL Firestore"})${apply ? "" : ", dry run"}`);
  const r = await deleteFlatCopies({ apply });
  const total = Object.values(r.deleted).reduce((n, x) => n + x, 0);
  console.log(`${apply ? "Deleted" : "Would delete"} ${total} top-level record(s), each with its sub-collections and History:`);
  for (const [k, n] of Object.entries(r.deleted).sort()) console.log(`  ${k.padEnd(40)} ${n}`);
  if (r.kept.length) {
    console.log(`Kept ${r.kept.length} document(s) (their record stays whole):`);
    for (const k of r.kept.slice(0, 50)) console.log(`  ${k.path}: ${k.why}`);
  }
  if (!apply && total) console.log("(dry run, nothing changed; re-run with --apply)");
}

if (process.argv[1]?.endsWith("delete-flat-copies.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
