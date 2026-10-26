/**
 * Dump every collection (sub-collections included) to <out>/<YYYY-MM-DD>/<collection>.json.
 *   tsx scripts/backup.ts [--out backups] [--date 2026-10-23]
 * Against the emulator when FIRESTORE_EMULATOR_HOST is set; otherwise real Firestore using
 * GOOGLE_APPLICATION_CREDENTIALS and GCLOUD_PROJECT (see .github/workflows/backup.yml and docs/BACKUP.md).
 */
import fs from "node:fs";
import path from "node:path";
import { firestore } from "@/server/admin";
import { dumpAll } from "@/server/backup";

const arg = (name: string, d: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };

export async function backup(outRoot: string, date: string, onProgress?: (docs: number) => void) {
  const dump = await dumpAll(firestore(), { onProgress });
  const dir = path.join(outRoot, date);
  fs.mkdirSync(dir, { recursive: true });
  const counts: Record<string, number> = {};
  for (const [col, rows] of Object.entries(dump)) {
    fs.writeFileSync(path.join(dir, `${col}.json`), JSON.stringify(rows, null, 2) + "\n");
    counts[col] = rows.length;
  }
  fs.writeFileSync(path.join(dir, "_manifest.json"), JSON.stringify({ date, project: process.env.GCLOUD_PROJECT ?? null, counts }, null, 2) + "\n");
  return { dir, counts };
}

/** "Read 1,234 documents…" on stderr, at most once a second, so a long run against real Firestore shows it is moving. */
function progress() {
  let last = 0;
  return (docs: number) => {
    if (Date.now() - last < 1000) return;
    last = Date.now();
    process.stderr.write(`Read ${docs.toLocaleString("en-US")} documents…\n`);
  };
}

if (process.argv[1]?.endsWith("backup.ts")) {
  backup(arg("out", "backups"), arg("date", new Date().toISOString().slice(0, 10)), progress()).then(
    ({ dir, counts }) => { console.log(`Backed up to ${dir}`, counts); },
    (e) => { console.error(e); process.exit(1); },
  );
}
