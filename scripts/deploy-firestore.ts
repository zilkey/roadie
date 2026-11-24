/**
 * `npm run deploy:firestore`: deploys firestore.rules, firestore.indexes.json and the TTL policies in it to roadie-prod-iab,
 * always as the project's service account, never as whoever happens to be logged in on the machine (a `firebase login`,
 * gcloud's default credentials or a stray GOOGLE_APPLICATION_CREDENTIALS gave 403s that depended on the machine).
 *
 * The key: GOOGLE_CREDENTIALS_JSON (cloud sessions) or .secrets/roadie-prod-iab-firebase-adminsdk-*.json (local).
 * It checks the account's permissions first. If any is missing it says exactly what to grant and deploys nothing.
 * After the deploy it lists the TTL policies and their state, and sets Firestore's own backups to BACKUP_SCHEDULES:
 * no backup outlives 30 days, so an account someone deleted is gone from every backup within 30 days (the privacy page's
 * promise; docs/BACKUP.md). Older backups from a longer schedule are deleted once a backup under these rules exists.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { GoogleAuth } from "google-auth-library";

const PROJECT = "roadie-prod-iab";
/** What `firebase deploy --only firestore` calls, and the role that grants each. */
const NEEDS: { permission: string; role: string; title: string }[] = [
  { permission: "serviceusage.services.get", role: "roles/serviceusage.serviceUsageViewer", title: "Service Usage Viewer" },
  { permission: "firebaserules.rulesets.test", role: "roles/firebaserules.admin", title: "Firebase Rules Admin" },
  { permission: "firebaserules.rulesets.create", role: "roles/firebaserules.admin", title: "Firebase Rules Admin" },
  { permission: "firebaserules.releases.update", role: "roles/firebaserules.admin", title: "Firebase Rules Admin" },
  { permission: "datastore.indexes.update", role: "roles/datastore.indexAdmin", title: "Cloud Datastore Index Admin" },
  { permission: "datastore.indexes.list", role: "roles/datastore.indexAdmin", title: "Cloud Datastore Index Admin" },
  { permission: "datastore.backupSchedules.list", role: "roles/datastore.backupSchedulesAdmin", title: "Cloud Datastore Backup Schedules Admin" },
  { permission: "datastore.backupSchedules.create", role: "roles/datastore.backupSchedulesAdmin", title: "Cloud Datastore Backup Schedules Admin" },
  { permission: "datastore.backupSchedules.update", role: "roles/datastore.backupSchedulesAdmin", title: "Cloud Datastore Backup Schedules Admin" },
  { permission: "datastore.backupSchedules.delete", role: "roles/datastore.backupSchedulesAdmin", title: "Cloud Datastore Backup Schedules Admin" },
  { permission: "datastore.backups.list", role: "roles/datastore.backupsAdmin", title: "Cloud Datastore Backups Admin" },
  { permission: "datastore.backups.delete", role: "roles/datastore.backupsAdmin", title: "Cloud Datastore Backups Admin" },
];

const DAY = 86_400;
/** Firestore's own backups (they live in the project and expire by themselves). Every retention is at most KEEP_DAYS. */
const KEEP_DAYS = 30;
const BACKUP_SCHEDULES: { label: string; recurrence: { dailyRecurrence: object } | { weeklyRecurrence: { day: string } }; retentionDays: number }[] = [
  { label: "daily, kept 7 days", recurrence: { dailyRecurrence: {} }, retentionDays: 7 },
  { label: "weekly (Tuesday), kept 4 weeks", recurrence: { weeklyRecurrence: { day: "TUESDAY" } }, retentionDays: 28 },
];
const DB = `projects/${PROJECT}/databases/(default)`;

type Client = Awaited<ReturnType<GoogleAuth["getClient"]>>;
type Schedule = { name: string; retention: string; dailyRecurrence?: object; weeklyRecurrence?: { day: string } };
type Backup = { name: string; database: string; snapshotTime: string; expireTime: string; state: string };
const seconds = (d: string) => Number(d.replace(/s$/, ""));
const sameRecurrence = (s: Schedule, w: (typeof BACKUP_SCHEDULES)[number]) =>
  "dailyRecurrence" in w.recurrence ? !!s.dailyRecurrence : s.weeklyRecurrence?.day === w.recurrence.weeklyRecurrence.day;

/** Makes the database's backup schedules exactly BACKUP_SCHEDULES. */
async function syncBackupSchedules(client: Client) {
  const base = `https://firestore.googleapis.com/v1/${DB}/backupSchedules`;
  const have = (await client.request<{ backupSchedules?: Schedule[] }>({ url: base })).data.backupSchedules ?? [];
  const used = new Set<string>();
  for (const w of BACKUP_SCHEDULES) {
    const retention = `${w.retentionDays * DAY}s`;
    const s = have.find((h) => !used.has(h.name) && sameRecurrence(h, w));
    if (!s) {
      await client.request({ url: base, method: "POST", data: { ...w.recurrence, retention } });
      console.log(`  backups ${w.label}: created`);
      continue;
    }
    used.add(s.name);
    if (seconds(s.retention) !== w.retentionDays * DAY) {
      await client.request({ url: `https://firestore.googleapis.com/v1/${s.name}?updateMask=retention`, method: "PATCH", data: { retention } });
      console.log(`  backups ${w.label}: retention was ${Math.round(seconds(s.retention) / DAY)} days`);
    } else console.log(`  backups ${w.label}: ok`);
  }
  for (const s of have.filter((h) => !used.has(h.name))) {
    await client.request({ url: `https://firestore.googleapis.com/v1/${s.name}`, method: "DELETE" });
    console.log(`  backup schedule ${s.name.split("/").pop()}: deleted (not in BACKUP_SCHEDULES)`);
  }
}

/**
 * Deletes backups that would outlive KEEP_DAYS (made under an older, longer schedule), but only once a backup that
 * keeps the rules is READY, so the database is never left with none.
 */
async function pruneLongBackups(client: Client) {
  const all = (await client.request<{ backups?: Backup[] }>({ url: `https://firestore.googleapis.com/v1/projects/${PROJECT}/locations/-/backups` })).data.backups ?? [];
  const ours = all.filter((b) => b.database.endsWith("/databases/(default)") && b.state === "READY");
  const life = (b: Backup) => (Date.parse(b.expireTime) - Date.parse(b.snapshotTime)) / 1000;
  const long = ours.filter((b) => life(b) > KEEP_DAYS * DAY + 3600);
  if (!long.length) return;
  if (!ours.some((b) => life(b) <= KEEP_DAYS * DAY + 3600)) {
    console.log(`  ${long.length} backup(s) outlive ${KEEP_DAYS} days; they go once a backup under the new schedules is ready (run this again tomorrow).`);
    return;
  }
  for (const b of long) {
    await client.request({ url: `https://firestore.googleapis.com/v1/${b.name}`, method: "DELETE" });
    console.log(`  backup of ${b.snapshotTime.slice(0, 10)} (kept until ${b.expireTime.slice(0, 10)}): deleted`);
  }
}

/** The key file to deploy with, and a cleanup for a temporary copy. */
function keyFile(): { file: string; done(): void } {
  const json = process.env.GOOGLE_CREDENTIALS_JSON;
  if (json) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "roadie-key-")), "key.json");
    fs.writeFileSync(file, json, { mode: 0o600 });
    return { file, done: () => fs.rmSync(path.dirname(file), { recursive: true, force: true }) };
  }
  const dir = ".secrets";
  const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^roadie-prod-iab-firebase-adminsdk-.*\.json$/.test(f)) : [];
  if (!found.length) throw new Error("No key: set GOOGLE_CREDENTIALS_JSON, or put the service account key in .secrets/roadie-prod-iab-firebase-adminsdk-*.json.");
  return { file: path.resolve(dir, found[0]), done: () => {} };
}

async function main() {
  const key = keyFile();
  try {
    const auth = new GoogleAuth({ keyFile: key.file, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const client = await auth.getClient();
    const email = (await auth.getCredentials()).client_email ?? "?";
    console.log(`Deploying as ${email}`);

    const r = await client.request<{ permissions?: string[] }>({
      url: `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:testIamPermissions`,
      method: "POST", data: { permissions: NEEDS.map((n) => n.permission) },
    });
    const has = new Set(r.data.permissions ?? []);
    // Rules and indexes deploy whenever their roles are there; only the backup step waits on the backup roles.
    const isBackup = (n: { permission: string }) => n.permission.startsWith("datastore.backup");
    const missingAll = NEEDS.filter((n) => !has.has(n.permission));
    const missing = missingAll.filter((n) => !isBackup(n));
    const missingBackup = missingAll.filter(isBackup);
    const grantHelp = (list: typeof NEEDS) => {
      const roles = [...new Map(list.map((m) => [m.role, m.title])).entries()];
      console.error(`\nOne time, as a project owner: https://console.cloud.google.com/iam-admin/iam?project=${PROJECT}`);
      console.error(`  find ${email}, click its pencil, and add the role${roles.length > 1 ? "s" : ""}: ${roles.map(([, t]) => t).join(", ")}.`);
      console.error(`\nOr with gcloud, logged in as the owner:`);
      for (const [role] of roles) console.error(`  gcloud projects add-iam-policy-binding ${PROJECT} --member=serviceAccount:${email} --role=${role} --condition=None`);
    };
    if (missing.length) {
      const roles = [...new Map(missing.map((m) => [m.role, m.title])).entries()];
      console.error(`\n${email} is missing: ${missing.map((m) => m.permission).join(", ")}.`);
      console.error(`\nOne time, as a project owner: https://console.cloud.google.com/iam-admin/iam?project=${PROJECT}`);
      console.error(`  find ${email}, click its pencil, and add the role${roles.length > 1 ? "s" : ""}: ${roles.map(([, t]) => t).join(", ")}.`);
      console.error(`\nOr with gcloud, logged in as the owner:`);
      for (const [role] of roles) console.error(`  gcloud projects add-iam-policy-binding ${PROJECT} --member=serviceAccount:${email} --role=${role} --condition=None`);
      console.error("\nNothing was deployed. Run this again once it's granted (it can take a minute to apply).");
      process.exit(1);
    }

    // The service account only: no `firebase login` token, no gcloud defaults. The Firebase CLI reads its stored login from
    // $XDG_CONFIG_HOME/configstore and prefers it, even an expired one ("credentials are no longer valid"), over the key.
    const env = { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: key.file, FIREBASE_TOKEN: "", CLOUDSDK_CONFIG: fs.mkdtempSync(path.join(os.tmpdir(), "roadie-gcloud-")), XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "roadie-xdg-")) };
    const run = spawnSync("npx", ["firebase", "deploy", "--only", "firestore", "--project", PROJECT, "--non-interactive"], { env, stdio: "inherit" });
    if (run.status !== 0) process.exit(run.status ?? 1);

    const ttl = await client.request<{ fields?: { name: string; ttlConfig?: { state?: string } }[] }>({
      url: `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/collectionGroups/-/fields?filter=ttlConfig:*`,
    });
    console.log("\nTTL policies:");
    for (const f of ttl.data.fields ?? []) console.log(`  ${f.name.split("/collectionGroups/")[1]?.replace("/fields/", ".")}: ${f.ttlConfig?.state ?? "?"}`);

    console.log("\nBackups:");
    if (missingBackup.length) {
      console.error(`  NOT SET: ${email} is missing ${missingBackup.map((m) => m.permission).join(", ")}. Rules and indexes deployed; the backup schedules did not.`);
      grantHelp(missingBackup);
      process.exit(1);
    }
    await syncBackupSchedules(client);
    await pruneLongBackups(client);
  } finally {
    key.done();
  }
}

main().catch((e) => { console.error(e?.response?.data ?? e); process.exit(1); });
