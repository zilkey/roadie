/**
 * Restore a backup folder made by scripts/backup.ts.
 *   tsx scripts/restore.ts <backups/2026-10-23> [--overwrite] [--yes] [--dry-run]
 * Every document is validated with the Zod schemas first; if any fails, nothing is written.
 * Refuses to touch a database that already has data unless --overwrite. Against real Firestore (no emulator host) it also needs --yes.
 * Auth accounts are not part of a backup: people sign in again with Google and /api/session re-sets their per-artist roles (claims) from the users doc.
 */
import fs from "node:fs";
import path from "node:path";
import { firestore } from "@/server/admin";
import { restoreDump, validateDump, type Dump } from "@/server/backup";

export function loadBackup(dir: string): Dump {
  const dump: Dump = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    dump[f.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  }
  return dump;
}

async function main() {
  const dir = process.argv[2];
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!dir || dir.startsWith("--")) throw new Error("Usage: tsx scripts/restore.ts <backup folder> [--overwrite] [--yes] [--dry-run]");
  const dump = loadBackup(dir);
  const errors = validateDump(dump);
  if (errors.length) {
    console.error(`${errors.length} document(s) failed validation, nothing written:\n` + errors.slice(0, 50).join("\n"));
    process.exit(2);
  }
  const total = Object.values(dump).reduce((n, r) => n + r.length, 0);
  console.log(`${total} documents in ${Object.keys(dump).length} collections validated.`);
  if (flag("dry-run")) return;
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes")) throw new Error("This would write to REAL Firestore. Re-run with --yes if that is what you want.");
  const fs_ = firestore();
  if (!flag("overwrite")) {
    for (const col of await fs_.listCollections()) {
      if (!(await col.limit(1).get()).empty) throw new Error(`Collection ${col.id} already has data. Use --overwrite to write over it.`);
    }
  }
  console.log(`Restored ${await restoreDump(fs_, dump)} documents.`);
}

if (process.argv[1]?.endsWith("restore.ts")) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
