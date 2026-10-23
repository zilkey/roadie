/** `npm run dev:all`: emulators + fakes + next dev, one terminal. Ctrl-C stops everything. Run `npm run seed` once the emulators are up. */
import { spawn, type ChildProcess } from "node:child_process";

const procs: ChildProcess[] = [];
const run = (name: string, cmd: string, args: string[]) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const tag = (d: Buffer) => d.toString().split("\n").filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout!.on("data", tag); p.stderr!.on("data", tag);
  p.on("exit", (c) => { console.log(`[${name}] exited ${c}`); stop(); });
  procs.push(p);
};
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  procs.forEach((p) => p.kill("SIGTERM"));
  setTimeout(() => process.exit(0), 1500);
}
process.on("SIGINT", stop); process.on("SIGTERM", stop);

run("emulators", "npx", ["firebase", "emulators:start", "--only", "firestore,auth", "--project", "demo-band-tracker", "--import", ".emulator-data", "--export-on-exit"]);
run("fakes", "npx", ["tsx", "fakes/run-all.ts"]);
run("next", "npx", ["next", "dev", "-p", "3100"]);
