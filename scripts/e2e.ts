/**
 * The Playwright suite, split into shards that run side by side.
 *   npm run e2e                                  every spec, E2E_SHARDS shards (default 4, at most 5)
 *   npm run e2e -- tests/e2e/shows.spec.ts       anything after -- goes to `playwright test`; named specs run in one shard
 *   E2E_SHARDS=1 npm run e2e                     one shard, as slow as it used to be
 *
 * The specs share one seeded database and run in file order, so they can't share a stack. Each shard gets its own:
 * emulators, fakes, Next dev server (its own build folder) and seed, on its own ports. Shard n's ports are the test
 * ports (tests/e2e/env.ts: dev port + TEST_PORT_OFFSET) plus 1000 x n, which leaves the test ports themselves free
 * for `npm run test:emulator` to run at the same time. Playwright's --shard=n/N decides which spec files a shard runs.
 *
 * Each shard's output is kept in test-output/e2e-<n>.txt. The terminal shows one line per test, prefixed with its
 * shard, and at the end each failing shard's failure section. Exits 1 if any shard fails.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const OUT_DIR = "test-output";
const BASE_OFFSET = Number(process.env.TEST_PORT_OFFSET ?? 10);
const args = process.argv.slice(2);
// Naming specs usually means a rerun of a few: one stack is quicker to start than four.
const namedSpecs = args.some((a) => !a.startsWith("-"));
const SHARDS = Math.max(1, Math.min(5, Number(process.env.E2E_SHARDS ?? (namedSpecs ? 1 : 4))));

/** The failure section of a failing run's output, or all of it when Playwright never got as far as a summary. */
function errorsOnly(output: string): string {
  const at = output.search(/^ +1\) /m);
  return at === -1 ? output : output.slice(at);
}

const free = (port: number) => new Promise<boolean>((ok) => {
  const s = net.createServer().once("error", () => ok(false)).once("listening", () => s.close(() => ok(true)));
  s.listen(port, "127.0.0.1");
});

/** firebase.e2e-<n>.json: firebase.json with the emulators moved to the shard's ports. Gitignored. */
function writeConfig(n: number, offset: number): string {
  const base = JSON.parse(fs.readFileSync("firebase.json", "utf8"));
  base.emulators = {
    auth: { port: 9319 + offset }, firestore: { port: 8280 + offset }, ui: { enabled: false },
    hub: { port: 4600 + offset }, logging: { port: 4700 + offset }, singleProjectMode: false,
  };
  const file = `firebase.e2e-${n}.json`;
  fs.writeFileSync(file, JSON.stringify(base, null, 2) + "\n");
  return file;
}

async function runShard(n: number): Promise<{ n: number; ok: boolean; seconds: number; file: string }> {
  const offset = BASE_OFFSET + 1000 * n;
  const file = path.join(OUT_DIR, `e2e-${n}.txt`);
  const busy: number[] = [];
  for (const p of [3100, 8280, 9319, 4600, 4700]) if (!(await free(p + offset))) busy.push(p + offset);
  if (busy.length) {
    fs.writeFileSync(file, `Shard ${n} did not start: port(s) ${busy.join(", ")} already in use (another e2e run?).\n`);
    return { n, ok: false, seconds: 0, file };
  }
  const config = writeConfig(n, offset);
  fs.rmSync(`.fake-data-test-${n}`, { recursive: true, force: true });
  const playwright = ["playwright", "test", `--shard=${n}/${SHARDS}`, ...args].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  const started = Date.now();
  const out = fs.createWriteStream(file);
  const child = spawn("npx", ["firebase", "emulators:exec", "--config", config, "--only", "firestore,auth", "--project", "demo-band-tracker", `tsx scripts/seed.ts && ${playwright}`], {
    env: { ...process.env, TEST_PORT_OFFSET: String(offset), E2E_SHARD: String(n), GCLOUD_PROJECT: "demo-band-tracker", FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let pending = "";
  const onData = (chunk: Buffer) => {
    out.write(chunk);
    pending += chunk.toString();
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    // One line per test (and the run's own summary lines); the rest is in the file.
    for (const l of lines) if (/^\s+[✓✘-]\s|^Running \d+ tests|^\s+\d+ (passed|failed|flaky|skipped|did not run)/.test(l)) console.log(`[${n}] ${l.trimEnd()}`);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const code = await new Promise<number>((done) => child.on("close", (c) => done(c ?? 1)));
  await new Promise((done) => out.end(done));
  fs.rmSync(config, { force: true });
  return { n, ok: code === 0, seconds: Math.round((Date.now() - started) / 1000), file };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of fs.readdirSync(OUT_DIR)) if (/^e2e(-\d+)?\.txt$/.test(f)) fs.rmSync(path.join(OUT_DIR, f));
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: SHARDS }, (_, i) => runShard(i + 1)));
  console.log("");
  for (const r of results) {
    console.log(`e2e shard ${r.n}/${SHARDS}: ${r.ok ? "passed" : "FAILED"} in ${r.seconds}s -> ${r.file}`);
    if (!r.ok) console.log(errorsOnly(fs.readFileSync(r.file, "utf8")));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`e2e: ${failed.length ? `${failed.length} of ${SHARDS} shard(s) FAILED` : "passed"} in ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(failed.length ? 1 : 0);
}

main();
