/**
 * Roadie's platform settings for the shared directory (tenancy plan, phase 1): who runs Roadie itself (`platform/admins`), and
 * who may change shared venues, acts, promoters and festivals (`platformUsers/{uid}.sharedEditorAt`).
 *
 *   GCLOUD_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS=.secrets/<key>.json \
 *     npx tsx scripts/platform-admins.ts [--admin <login email>]... [--approve-artist <artistId>] [--admins-only] [--dry-run]
 *
 * - No flags: prints the platform admins, the approved editors, and every artist oldest first with its admins.
 * - `--admin <email>`: adds that login (its users doc) to platform/admins. Never removes anyone.
 * - `--approve-artist <id>`: approves every admin and member of that artist (Q10-A); with `--admins-only`, its admins only (Q10-B).
 *   The real artist is the oldest artist whose admins include the platform admin's login; the listing marks it.
 * - `--dry-run`: says what it would do and writes nothing.
 *
 * Refuses to run without GCLOUD_PROJECT, so it can't silently write the demo project.
 */
import type { Timestamp } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { PLATFORM_ADMINS_DOC, PLATFORM_USERS, addPlatformAdmins, approveEditor, membersOf } from "@/server/platform";
import type { Membership } from "@/schema/users";

const args = process.argv.slice(2);
const values = (flag: string) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : a.startsWith(`${flag}=`) ? [a.slice(flag.length + 1)] : []));
const dry = args.includes("--dry-run");

async function main() {
  if (!process.env.GCLOUD_PROJECT) throw new Error("Set GCLOUD_PROJECT (e.g. roadie-prod-iab)");
  const fs = firestore();
  const users = (await fs.collection("users").get()).docs.map((d) => ({ id: d.id, ...(d.data() as { email: string; name: string; artists?: Membership[]; deletedAt?: unknown }) }));
  const byEmail = new Map(users.filter((u) => !u.deletedAt).map((u) => [u.email.toLowerCase(), u]));

  for (const email of values("--admin")) {
    const u = byEmail.get(email.toLowerCase());
    if (!u) throw new Error(`No live user with the email ${email}`);
    console.log(`${dry ? "Would add" : "Adding"} ${u.name} (${u.id}) to ${PLATFORM_ADMINS_DOC}`);
    if (!dry) await addPlatformAdmins([u.id]);
  }

  const [artistId] = values("--approve-artist");
  if (artistId) {
    const artist = await fs.collection("artists").doc(artistId).get();
    if (!artist.exists || artist.data()?.deletedAt) throw new Error(`No live artist ${artistId}`);
    const people = await membersOf(artistId, args.includes("--admins-only"));
    console.log(`${dry ? "Would approve" : "Approving"} ${people.length} ${args.includes("--admins-only") ? "admins" : "people"} of ${artist.data()!.name} as shared editors:`);
    for (const p of people) {
      console.log(`  ${p.name} (${p.role})`);
      if (!dry) await approveEditor(p.uid, "scripts/platform-admins");
    }
  }

  // What's there now.
  const admins = ((await fs.doc(PLATFORM_ADMINS_DOC).get()).data()?.uids as string[] | undefined) ?? [];
  const nameOf = (uid: string) => users.find((u) => u.id === uid)?.name ?? uid;
  console.log(`\nPlatform admins: ${admins.length ? admins.map(nameOf).join(", ") : "(none)"}`);
  const editors = (await fs.collection(PLATFORM_USERS).get()).docs.filter((d) => d.data().sharedEditorAt).map((d) => nameOf(d.id));
  console.log(`Approved shared editors: ${editors.length ? editors.sort().join(", ") : "(none)"}`);
  const artists = (await fs.collection("artists").get()).docs.filter((d) => !d.data().deletedAt)
    .sort((a, b) => ((a.data().createdAt as Timestamp | undefined)?.toMillis() ?? 0) - ((b.data().createdAt as Timestamp | undefined)?.toMillis() ?? 0));
  const adminsOf = (id: string) => users.filter((u) => !u.deletedAt && (u.artists ?? []).some((m) => m.artistId === id && m.role === "admin"));
  const real = artists.find((a) => adminsOf(a.id).some((u) => admins.includes(u.id)));
  console.log("\nArtists, oldest first:");
  for (const a of artists) {
    const d = a.data();
    console.log(`  ${a.id}  ${d.name} (created ${(d.createdAt as Timestamp | undefined)?.toDate().toISOString().slice(0, 10) ?? "?"}) admins: ${adminsOf(a.id).map((u) => u.name).join(", ") || "none"}${a.id === real?.id ? "  <- the real artist (oldest with a platform admin as admin)" : ""}`);
  }
}
main().then(() => process.exit(0), (e) => { console.error(e.message ?? e); process.exit(1); });
