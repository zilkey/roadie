/**
 * Create the FIRST admin in a real project (after that, admins invite people from /admin/users).
 *
 *   GCLOUD_PROJECT=band-tracker GOOGLE_APPLICATION_CREDENTIALS=./key.json \
 *     npx tsx scripts/bootstrap-admin.ts you@gmail.com "Your Name"
 *
 * Runs the normal users.add command (Auth user + users/{uid} doc), then sets the {role:'admin'} custom claim.
 * Safe to run twice. Refuses to run without GCLOUD_PROJECT (so it can't silently hit the demo project).
 */
import { registry } from "@/server/commands/registry";
import { importCtx } from "@/server/ctx";
import { adminAuth } from "@/server/admin";

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ") || email?.split("@")[0];
  if (!email || !email.includes("@")) throw new Error('Usage: tsx scripts/bootstrap-admin.ts <google-email> "<Name>"');
  if (!process.env.GCLOUD_PROJECT) throw new Error("Set GCLOUD_PROJECT (e.g. band-tracker)");
  const cmd = registry["users.add"];
  if (!cmd) throw new Error("users.add not found");
  await cmd.run(importCtx("bootstrap"), cmd.input.parse({ email, name, role: "admin" }));
  const user = await adminAuth().getUserByEmail(email.toLowerCase());
  await adminAuth().setCustomUserClaims(user.uid, { role: "admin" });
  console.log(`Admin ready: ${email} (uid ${user.uid}) in project ${process.env.GCLOUD_PROJECT}. Sign in with Google.`);
}
main().then(() => process.exit(0), (e) => { console.error(e.message ?? e); process.exit(1); });
