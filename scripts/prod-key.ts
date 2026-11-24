/**
 * How every prod script authenticates: the roadie-prod-iab service-account key, never whoever is logged in to gcloud or the
 * Firebase CLI on this machine (those are often other projects' accounts, or an expired login: "invalid_rapt").
 *
 * Order: GOOGLE_CREDENTIALS_JSON (cloud sessions), GOOGLE_APPLICATION_CREDENTIALS if it points at a file, then
 * .secrets/roadie-prod-iab-firebase-adminsdk-*.json.
 *
 * The one thing the key can't do is grant roles to itself. That needs the project owner, OWNER, running gcloud in its own
 * config folder (OWNER_GCLOUD) so the machine's other gcloud and Firebase logins are untouched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const OWNER = "jeff@zilkey.com";
export const OWNER_GCLOUD = "CLOUDSDK_CONFIG=$HOME/.config/gcloud-roadie gcloud";

/** The key file to use, and a cleanup for a temporary copy. */
export function keyFile(): { file: string; done(): void } {
  const json = process.env.GOOGLE_CREDENTIALS_JSON;
  if (json) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "roadie-key-")), "key.json");
    fs.writeFileSync(file, json, { mode: 0o600 });
    return { file, done: () => fs.rmSync(path.dirname(file), { recursive: true, force: true }) };
  }
  const set = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (set && fs.existsSync(set)) return { file: path.resolve(set), done: () => {} };
  const dir = ".secrets";
  const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^roadie-prod-iab-firebase-adminsdk-.*\.json$/.test(f)) : [];
  if (!found.length) throw new Error("No key: set GOOGLE_CREDENTIALS_JSON, or put the service account key in .secrets/roadie-prod-iab-firebase-adminsdk-*.json.");
  return { file: path.resolve(dir, found[0]), done: () => {} };
}
