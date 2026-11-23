import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expiredBackupFolders, pruneBackups } from "../../scripts/backup-prune";

const now = new Date("2026-11-23T15:00:00Z");

test("dated folders older than 30 days expire, whatever follows the date", () => {
  const names = ["2026-10-23", "2026-10-22T21-07-03", "2026-10-20-before-contacts", "2026-10-24", "2026-11-10-after-x", "local-before-thing", "notes"];
  assert.deepEqual(expiredBackupFolders(names, now), ["2026-10-20-before-contacts", "2026-10-22T21-07-03", "2026-10-23"]);
});

test("pruneBackups deletes only expired folders", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prune-"));
  for (const n of ["2026-09-01", "2026-11-20", "local-x"]) fs.mkdirSync(path.join(root, n));
  fs.writeFileSync(path.join(root, "2026-01-01.txt"), "a file, not a backup");
  assert.deepEqual(pruneBackups(root, now), ["2026-09-01"]);
  assert.deepEqual(fs.readdirSync(root).sort(), ["2026-01-01.txt", "2026-11-20", "local-x"]);
  fs.rmSync(root, { recursive: true });
});
