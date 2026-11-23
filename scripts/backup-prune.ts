/** Old dumps of real data go: they hold people who have since deleted their account (docs/BACKUP.md, "Deleted accounts"). */
import fs from "node:fs";
import path from "node:path";

/** How long a dump of real data may be kept (the privacy page's promise). */
export const BACKUP_KEEP_DAYS = 30;

/** Folders in a backups dir whose name starts with a date (2026-10-24, 2026-10-24T21-07-03, 2026-11-10-before-x) older than `days`. */
export function expiredBackupFolders(names: string[], now: Date, days = BACKUP_KEEP_DAYS): string[] {
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return names.filter((n) => /^\d{4}-\d{2}-\d{2}/.test(n) && n.slice(0, 10) < cutoff).sort();
}

/** Deletes the expired dated folders in `outRoot`; returns their names. */
export function pruneBackups(outRoot: string, now = new Date()): string[] {
  if (!fs.existsSync(outRoot)) return [];
  const dirs = fs.readdirSync(outRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const gone = expiredBackupFolders(dirs, now);
  for (const n of gone) fs.rmSync(path.join(outRoot, n), { recursive: true, force: true });
  return gone;
}
