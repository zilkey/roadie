/**
 * Make the Auth EMULATOR's accounts match the `users` collection: one account per live users doc, with the doc id as
 * its uid, email verified, and custom claims synced. Needed after `npm run restore` of a backup, because backups carry
 * no Auth accounts and `authenticate` (src/server/commands/dispatch.ts) looks `users` up by the token's uid.
 *   npm run align-auth [-- --dry-run]
 * Emulator only: refuses without FIREBASE_AUTH_EMULATOR_HOST.
 */
import { adminAuth, firestore } from "@/server/admin";
import { syncClaims } from "@/server/session";

async function main() {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("align-auth only runs against the Auth emulator (FIREBASE_AUTH_EMULATOR_HOST is not set).");
  const dry = process.argv.includes("--dry-run");
  const auth = adminAuth();
  const docs = await firestore().collection("users").get();
  let changed = 0;
  for (const d of docs.docs) {
    const u = d.data();
    const email = typeof u.email === "string" ? u.email.trim().toLowerCase() : "";
    if (!email || u.deletedAt) continue;
    const existing = await auth.getUserByEmail(email).catch(() => null);
    if (existing?.uid === d.id) { console.log(`ok       ${d.id} ${email}`); continue; }
    changed++;
    if (dry) { console.log(`would ${existing ? "replace" : "create"} ${d.id} ${email}${existing ? ` (local uid ${existing.uid})` : ""}`); continue; }
    if (existing) await auth.deleteUser(existing.uid);
    await auth.createUser({ uid: d.id, email, emailVerified: true, displayName: typeof u.name === "string" ? u.name : undefined });
    await syncClaims(d.id);
    console.log(`${existing ? "replaced" : "created "} ${d.id} ${email}`);
  }
  console.log(dry ? `${changed} account(s) would change.` : `${changed} account(s) changed. Sign out and back in to pick up the new uid.`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
