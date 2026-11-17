/**
 * Open or close sign-up (Start a band) without a deploy: writes the server-only doc platform/config.
 *
 *   GCLOUD_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS=.secrets/<key>.json npx tsx scripts/platform-config.ts          # show it
 *   ... npx tsx scripts/platform-config.ts --sign-up=open     # anyone with a Google account may start a band
 *   ... npx tsx scripts/platform-config.ts --sign-up=closed   # invite-only (the default when the doc doesn't exist)
 *
 * src/server/signUp.ts reads it on every sign-up. Refuses to run without GCLOUD_PROJECT (so it can't silently hit the demo project).
 */
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";

async function main() {
  if (!process.env.GCLOUD_PROJECT) throw new Error("Set GCLOUD_PROJECT (e.g. roadie-prod-iab)");
  const arg = process.argv.slice(2).find((a) => a.startsWith("--sign-up="))?.slice("--sign-up=".length);
  if (arg !== undefined && arg !== "open" && arg !== "closed") throw new Error("Usage: platform-config.ts [--sign-up=open|closed]");
  const ref = firestore().doc("platform/config");
  if (arg) await ref.set({ signUpOpen: arg === "open", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const now = (await ref.get()).data();
  console.log(`${process.env.GCLOUD_PROJECT} platform/config: sign-up is ${now?.signUpOpen === true ? "OPEN" : "closed (invite-only)"}${arg ? " (just set)" : ""}`);
}
main().then(() => process.exit(0), (e) => { console.error(e.message ?? e); process.exit(1); });
