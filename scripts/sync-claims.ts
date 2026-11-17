/**
 * Re-set every person's sign-in claims from their users doc (`syncClaims`), so tokens carry `adminOf` and `musicians` (tenancy
 * phase 3, after the backfill fills `Membership.musicianId`). A token picks the new claims up at its next refresh (within an hour).
 *   npm run sync:claims                (dry run: lists whose claims would change, changes nothing)
 *   npm run sync:claims -- --apply     (sets them)
 * Against the emulators, set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST; against prod, GCLOUD_PROJECT and
 * GOOGLE_APPLICATION_CREDENTIALS. A users doc with no sign-in account (an invite never used) is skipped.
 */
import { isDeepStrictEqual } from "node:util";
import { adminAuth, firestore } from "@/server/admin";
import { claimsBytes, claimsFor, CLAIMS_MAX_BYTES, syncClaims } from "@/server/session";

export interface SyncResult { changed: string[]; same: number; noAccount: string[]; tooBig: string[] }

export async function syncAllClaims(opts: { apply: boolean; log?: (s: string) => void }): Promise<SyncResult> {
  const log = opts.log ?? (() => undefined);
  const out: SyncResult = { changed: [], same: 0, noAccount: [], tooBig: [] };
  for (const u of (await firestore().collection("users").get()).docs) {
    const d = u.data();
    const want = d.deletedAt ? {} : claimsFor(d);
    const label = `${(d.name as string | undefined) ?? "?"} <${(d.email as string | undefined) ?? "?"}> (${u.id})`;
    if (claimsBytes(want) > CLAIMS_MAX_BYTES) { out.tooBig.push(label); log(`too big, skipped: ${label}`); continue; }
    const account = await adminAuth().getUser(u.id).catch(() => null);
    if (!account) { out.noAccount.push(label); continue; }
    if (isDeepStrictEqual(account.customClaims ?? {}, want)) { out.same++; continue; }
    out.changed.push(label);
    log(`${opts.apply ? "set" : "would set"} ${label}: ${JSON.stringify(want)}`);
    if (opts.apply) await syncClaims(u.id);
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  const project = process.env.GCLOUD_PROJECT;
  if (!project && !emulator) throw new Error("No target: set GCLOUD_PROJECT (real Firestore) or FIRESTORE_EMULATOR_HOST (emulator). Refusing to guess.");
  console.log(`Target: ${project ?? "demo-band-tracker"} (${emulator ? `emulator at ${emulator}` : "REAL project"})${apply ? "" : ", dry run"}`);
  const r = await syncAllClaims({ apply, log: (s) => console.log(`  ${s}`) });
  console.log(`${apply ? "Set" : "Would set"} ${r.changed.length}; ${r.same} already right; ${r.noAccount.length} without a sign-in account; ${r.tooBig.length} too big.`);
  for (const n of r.noAccount) console.log(`  no account: ${n}`);
  if (!apply) console.log("(dry run, nothing changed; re-run with --apply)");
  if (r.tooBig.length) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("sync-claims.ts")) main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
