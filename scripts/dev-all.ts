/**
 * `npm run dev:all`: emulators + fakes + next dev, one terminal. Ctrl-C stops everything.
 * Run `npm run seed` once the emulators are up.
 *
 * Emulator data lives in .emulator-data/ between runs: imported at start, exported on Ctrl-C, and
 * snapshotted every 5 minutes so a closed terminal or a crash loses at most that much.
 * Children run in their own process groups so the terminal's Ctrl-C doesn't reach them directly:
 * the Firebase CLI treats a second signal as "quit now, skip the export", so it must get exactly one.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const DATA = ".emulator-data";
const PROJECT = "demo-band-tracker";
const SNAPSHOT_MS = 5 * 60_000;

const procs = new Map<string, ChildProcess>();
const run = (name: string, cmd: string, args: string[]) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env, detached: true });
  const tag = (d: Buffer) => d.toString().split("\n").filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout!.on("data", tag); p.stderr!.on("data", tag);
  p.on("exit", (c) => { console.log(`[${name}] exited ${c}`); procs.delete(name); if (!procs.size) process.exit(0); stop(); });
  procs.set(name, p);
};
const signal = (p: ChildProcess, sig: NodeJS.Signals) => { try { process.kill(-p.pid!, sig); } catch { /* already gone */ } };

let snapshotting = false;
function snapshot() {
  if (stopping || snapshotting) return;
  snapshotting = true;
  const p = spawn("npx", ["firebase", "emulators:export", DATA, "--force", "--project", PROJECT], { stdio: "ignore" });
  p.on("exit", (c) => { snapshotting = false; if (c !== 0) console.log(`[emulators] snapshot to ${DATA} failed (${c})`); });
}
const timer = setInterval(snapshot, SNAPSHOT_MS);

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  console.log(`[dev-all] stopping; saving emulator data to ${DATA}…`);
  for (const [name, p] of procs) signal(p, name === "emulators" ? "SIGINT" : "SIGTERM");
  // The export usually takes a few seconds; give it a minute before forcing.
  setTimeout(() => { for (const p of procs.values()) signal(p, "SIGKILL"); process.exit(1); }, 60_000).unref();
}
process.on("SIGINT", stop); process.on("SIGTERM", stop); process.on("SIGHUP", stop);

// Leftover temp dirs from an export that was cut short.
spawnSync("find", [".", "-maxdepth", "2", "-path", "./firebase-export-*", "-type", "d", "-empty", "-delete"]);
run("emulators", "npx", ["firebase", "emulators:start", "--only", "firestore,auth", "--project", PROJECT, "--import", DATA, `--export-on-exit=${DATA}`]);
run("fakes", "npx", ["tsx", "fakes/run-all.ts"]);
run("next", "npx", ["next", "dev", "-p", "3100"]);
