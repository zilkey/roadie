/**
 * Run the unit suite, then the e2e suite, keeping only each suite's errors in a gitignored file.
 *   npm run test:all
 *
 * Both files in test-output/ are emptied before the run. A passing suite leaves its file empty. A failing suite
 * writes the runner's failure section: the spec reporter's "✖ failing tests:" summary for unit, and the list
 * reporter's numbered failures ("  1) ...") for e2e. If no such section is found (the emulators or the web server
 * never started, so no test ran), the whole output is kept so nothing is lost. The e2e suite runs even when unit
 * fails. Exits 1 if either suite fails.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const OUT_DIR = "test-output";

const SUITES = [
  { name: "unit", script: "test", file: path.join(OUT_DIR, "unit.txt"), marker: /^✖ failing tests:$/m },
  { name: "e2e", script: "e2e", file: path.join(OUT_DIR, "e2e.txt"), marker: /^ +1\) /m },
];

/** The failure section of a failing run's output, or all of it when the runner never got as far as a summary. */
export function errorsOnly(output: string, marker: RegExp): string {
  const at = output.search(marker);
  return at === -1 ? output : output.slice(at);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const s of SUITES) fs.writeFileSync(s.file, "");

let failed = false;
for (const s of SUITES) {
  console.log(`Running ${s.name}...`);
  // Collect stdout and stderr together, in order, so the kept section reads as it did in the terminal.
  const run = spawnSync("sh", ["-c", `npm run ${s.script} 2>&1`], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  const ok = run.status === 0;
  if (!ok) {
    failed = true;
    fs.writeFileSync(s.file, errorsOnly(run.stdout ?? "", s.marker));
  }
  console.log(`  ${s.name}: ${ok ? "passed" : "FAILED"} -> ${s.file}`);
}

process.exit(failed ? 1 : 0);
