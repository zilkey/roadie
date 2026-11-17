/**
 * `npm run deploy:firestore`: deploys firestore.rules, firestore.indexes.json and the TTL policies in it to roadie-prod-iab,
 * always as the project's service account, never as whoever happens to be logged in on the machine (a `firebase login`,
 * gcloud's default credentials or a stray GOOGLE_APPLICATION_CREDENTIALS gave 403s that depended on the machine).
 *
 * The key: GOOGLE_CREDENTIALS_JSON (cloud sessions) or .secrets/roadie-prod-iab-firebase-adminsdk-*.json (local).
 * It checks the account's permissions first. If any is missing it says exactly what to grant and deploys nothing.
 * After the deploy it lists the TTL policies and their state.
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
];

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
    const missing = NEEDS.filter((n) => !has.has(n.permission));
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

    // The service account only: no `firebase login` token, no gcloud defaults.
    const env = { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: key.file, FIREBASE_TOKEN: "", CLOUDSDK_CONFIG: fs.mkdtempSync(path.join(os.tmpdir(), "roadie-gcloud-")) };
    const run = spawnSync("npx", ["firebase", "deploy", "--only", "firestore", "--project", PROJECT, "--non-interactive"], { env, stdio: "inherit" });
    if (run.status !== 0) process.exit(run.status ?? 1);

    const ttl = await client.request<{ fields?: { name: string; ttlConfig?: { state?: string } }[] }>({
      url: `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/collectionGroups/-/fields?filter=ttlConfig:*`,
    });
    console.log("\nTTL policies:");
    for (const f of ttl.data.fields ?? []) console.log(`  ${f.name.split("/collectionGroups/")[1]?.replace("/fields/", ".")}: ${f.ttlConfig?.state ?? "?"}`);
  } finally {
    key.done();
  }
}

main().catch((e) => { console.error(e?.response?.data ?? e); process.exit(1); });
