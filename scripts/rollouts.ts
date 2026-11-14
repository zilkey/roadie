/**
 * `npm run rollouts [-- <sha>]`: is a commit live? Lists App Hosting's latest rollouts of roadie-web-prod with the commit
 * each one built. With a sha (default: origin/main), waits up to 20 minutes for that commit's rollout to finish, then
 * exits 0 if it SUCCEEDED and 1 otherwise. Uses Application Default Credentials (in a cloud session, the key from
 * AGENTS.md via GOOGLE_APPLICATION_CREDENTIALS).
 */
import { execSync } from "node:child_process";
import { GoogleAuth } from "google-auth-library";

const BACKEND = "projects/roadie-prod-iab/locations/us-central1/backends/roadie-web-prod";
const API = "https://firebaseapphosting.googleapis.com/v1";
interface Rollout { name: string; createTime: string; state: string; build: string; error?: unknown }

async function main() {
const sha = process.argv[2] ?? execSync("git rev-parse origin/main", { encoding: "utf8" }).trim();
const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
const get = async <T>(url: string) => (await client.request<T>({ url })).data;

async function latest(n: number) {
  const all: Rollout[] = [];
  let token = "";
  do {
    const page = await get<{ rollouts?: Rollout[]; nextPageToken?: string }>(`${API}/${BACKEND}/rollouts?pageSize=100${token ? `&pageToken=${token}` : ""}`);
    all.push(...(page.rollouts ?? []));
    token = page.nextPageToken ?? "";
  } while (token);
  all.sort((a, b) => a.createTime.localeCompare(b.createTime));
  return Promise.all(all.slice(-n).map(async (r) => {
    const b = await get<{ source?: { codebase?: { hash?: string } } }>(`${API}/${r.build}`);
    return { ...r, hash: b.source?.codebase?.hash ?? "" };
  }));
}

const done = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);
for (let i = 0; i < 40; i++) {
  const rows = await latest(5);
  const mine = rows.find((r) => r.hash.startsWith(sha));
  if (i === 0) for (const r of rows) console.log(r.createTime.slice(0, 19), r.state.padEnd(10), r.hash.slice(0, 7), r.error ? JSON.stringify(r.error) : "");
  if (mine && done.has(mine.state)) {
    console.log(`${sha.slice(0, 7)}: ${mine.state}${mine.error ? ` ${JSON.stringify(mine.error)}` : ""}`);
    process.exit(mine.state === "SUCCEEDED" ? 0 : 1);
  }
  if (!mine && rows.some((r) => r.state === "SUCCEEDED" && r.createTime > new Date(Date.now() - 864e5).toISOString())) {
    // A newer commit's rollout can replace ours before it starts: fine if ours is an ancestor of what's live.
    const live = rows.filter((r) => r.state === "SUCCEEDED").at(-1)!;
    try { execSync(`git merge-base --is-ancestor ${sha} ${live.hash}`, { stdio: "ignore" }); console.log(`${sha.slice(0, 7)}: live as part of ${live.hash.slice(0, 7)}`); process.exit(0); } catch {}
  }
  await new Promise((r) => setTimeout(r, 30_000));
}
console.log(`${sha.slice(0, 7)}: no finished rollout after 20 minutes`);
process.exit(1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
