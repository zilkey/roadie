/**
 * Test ports for worktrees, so several agents can run `npm test` / `npm run e2e` at once.
 * `npm run worktree:ports -- claim <session-id>`  claim an offset for this worktree, write firebase.worktree.json
 * `npm run worktree:ports -- env`                 print the env prefix for this worktree's test runs
 * `npm run worktree:ports -- release`             give this worktree's offset back
 * `npm run worktree:ports -- list`                show every claim
 *
 * Claims live in `emulators` at the root of the main checkout (gitignored), one line each, shared by every worktree.
 * Every test port is its dev port + the offset (tests/e2e/env.ts): dev is +0, the main checkout's tests +10,
 * worktrees +20 to +90. A claim is keyed by worktree path; claiming again from the same worktree reuses it.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const OFFSETS = [20, 30, 40, 50, 60, 70, 80, 90];
// Dev ports the test run shifts: Next, fakes, Firestore, Auth, emulator hub, logging.
const DEV_PORTS = [3100, 3201, 3202, 3203, 3204, 3205, 3206, 3207, 8280, 9319, 4600, 4700];
const CONFIG = "firebase.worktree.json";

const git = (args: string) => execSync(`git ${args}`, { encoding: "utf8" }).trim();
const worktree = git("rev-parse --show-toplevel");
const mainCheckout = path.dirname(path.resolve(worktree, git("rev-parse --git-common-dir")));
const FILE = path.join(mainCheckout, "emulators");
const LOCK = `${FILE}.lock`;

interface Claim { offset: number; session: string; branch: string; worktree: string; claimed: string }
const HEADER = "# offset  session  branch  worktree  claimed   (ports: dev port + offset; firestore 8280, auth 9319, next 3100, fakes 3201-3207, hub 4600, logging 4700)";

function read(): Claim[] {
  if (!fs.existsSync(FILE)) return [];
  return fs.readFileSync(FILE, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => {
    const [offset, session, branch, wt, claimed] = l.trim().split(/\s+/);
    return { offset: Number(offset), session, branch, worktree: wt, claimed };
  });
}
function write(claims: Claim[]) {
  const lines = claims.sort((a, b) => a.offset - b.offset).map((c) => [c.offset, c.session, c.branch, c.worktree, c.claimed].join("  "));
  fs.writeFileSync(FILE, [HEADER, ...lines, ""].join("\n"));
}
async function locked<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(LOCK); break; } catch {
      if (i > 50) throw new Error(`${LOCK} held for 10s; remove it if no claim is running`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  try { return await fn(); } finally { fs.rmdirSync(LOCK); }
}
const free = (port: number) => new Promise<boolean>((ok) => {
  const s = net.createServer().once("error", () => ok(false)).once("listening", () => s.close(() => ok(true)));
  s.listen(port, "127.0.0.1");
});

function writeConfig(offset: number) {
  const base = JSON.parse(fs.readFileSync(path.join(worktree, "firebase.json"), "utf8"));
  base.emulators = {
    auth: { port: 9319 + offset }, firestore: { port: 8280 + offset }, ui: { enabled: false },
    hub: { port: 4600 + offset }, logging: { port: 4700 + offset }, singleProjectMode: true,
  };
  fs.writeFileSync(path.join(worktree, CONFIG), JSON.stringify(base, null, 2) + "\n");
}
const envLine = (offset: number) => `TEST_PORT_OFFSET=${offset} FIREBASE_TEST_CONFIG=${CONFIG}`;
const mine = (claims: Claim[]) => claims.find((c) => c.worktree === worktree);

async function main() {
  const [cmd, session] = process.argv.slice(2);
  if (cmd === "list") { console.log(fs.existsSync(FILE) ? fs.readFileSync(FILE, "utf8") : "(no claims)"); return; }
  if (cmd === "env") {
    const c = mine(read());
    if (!c) throw new Error(`no claim for ${worktree}; run claim first`);
    console.log(envLine(c.offset)); return;
  }
  if (worktree === mainCheckout) throw new Error("the main checkout uses the default test ports (offset 10); claim from a worktree");
  if (cmd === "claim") {
    if (!session) throw new Error("usage: claim <session-id>");
    const offset = await locked(async () => {
      const claims = read();
      const existing = mine(claims);
      if (existing) { existing.session = session; write(claims); return existing.offset; }
      for (const offset of OFFSETS) {
        if (claims.some((c) => c.offset === offset)) continue;
        if (!(await Promise.all(DEV_PORTS.map((p) => free(p + offset)))).every(Boolean)) continue;
        claims.push({ offset, session, branch: git("branch --show-current") || "detached", worktree, claimed: new Date().toISOString() });
        write(claims);
        return offset;
      }
      throw new Error(`every offset is claimed or busy; see ${FILE} and release stale claims`);
    });
    writeConfig(offset);
    console.log(envLine(offset)); return;
  }
  if (cmd === "release") {
    await locked(async () => write(read().filter((c) => c.worktree !== worktree)));
    fs.rmSync(path.join(worktree, CONFIG), { force: true });
    console.log(`released ${worktree}`); return;
  }
  throw new Error("usage: worktree-ports.ts claim <session-id> | env | release | list");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
