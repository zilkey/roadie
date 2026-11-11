/**
 * Run every suite at once, keeping only each suite's errors in a gitignored file.
 *   npm run test:all
 *
 * The three suites don't share anything, so they run side by side: unit (no emulator), emulator (the test
 * emulators) and e2e (its shards, each on a stack of its own: scripts/e2e.ts). The run takes as long as the slowest.
 *
 * test-output/ is emptied of these files before the run. A passing suite leaves its file empty. A failing suite
 * writes the runner's failure section: the spec reporter's "✖ failing tests:" summary for unit and emulator, and for
 * e2e what scripts/e2e.ts prints after its shards finish (each failing shard's numbered failures; a shard's whole
 * output is in test-output/e2e-<n>.txt). If no such section is found (the emulators or the web server never started,
 * so no test ran), the whole output is kept so nothing is lost. Exits 1 if any suite fails.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const OUT_DIR = "test-output";

const SUITES = [
  { name: "unit", script: "test:unit", file: path.join(OUT_DIR, "unit.txt"), marker: /^✖ failing tests:$/m },
  { name: "emulator", script: "test:emulator", file: path.join(OUT_DIR, "emulator.txt"), marker: /^✖ failing tests:$/m },
  { name: "e2e", script: "e2e", file: path.join(OUT_DIR, "e2e.txt"), marker: /^e2e shard \d+\/\d+: /m },
];

/** The failure section of a failing run's output, or all of it when the runner never got as far as a summary. */
export function errorsOnly(output: string, marker: RegExp): string {
  const at = output.search(marker);
  return at === -1 ? output : output.slice(at);
}

async function runSuite(s: (typeof SUITES)[number]): Promise<boolean> {
  const started = Date.now();
  // Collect stdout and stderr together, in order, so the kept section reads as it did in the terminal.
  const child = spawn("sh", ["-c", `npm run ${s.script} 2>&1`], { stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  child.stdout.on("data", (c: Buffer) => { output += c.toString(); });
  const code = await new Promise<number>((done) => child.on("close", (c) => done(c ?? 1)));
  const ok = code === 0;
  // e2e empties its own files in test-output when it starts, so this file is written only after it has finished.
  fs.writeFileSync(s.file, ok ? "" : errorsOnly(output, s.marker));
  console.log(`  ${s.name}: ${ok ? "passed" : "FAILED"} in ${Math.round((Date.now() - started) / 1000)}s -> ${s.file}`);
  return ok;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const s of SUITES) fs.writeFileSync(s.file, "");
  console.log(`Running ${SUITES.map((s) => s.name).join(", ")} side by side...`);
  const results = await Promise.all(SUITES.map(runSuite));
  process.exit(results.every(Boolean) ? 0 : 1);
}

main();
