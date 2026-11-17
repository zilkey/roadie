/**
 * Create the FIRST admin of an artist in a real project (after that, admins invite people from Settings → People).
 *
 *   GCLOUD_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS=./key.json \
 *     npx tsx scripts/bootstrap-admin.ts you@gmail.com "Your Name" ["Artist Name" | --artist=<slug>] [--time-zone=America/Chicago]
 *
 * Which artist: --artist=<slug> picks an existing one; otherwise the only artist there is; with none yet, it creates one
 * named by the third argument (its slug comes from the name) in --time-zone (default America/Denver). Then it runs the normal users.add command for that artist
 * (Auth user + users/{uid} doc + {artists: {artistId: "admin"}} claims). Already a member: it just makes sure of the
 * admin role. Safe to run twice. Refuses to run without GCLOUD_PROJECT (so it can't silently hit the demo project).
 */
import { registry } from "@/server/commands/registry";
import { importCtx, personCtx, systemCtx } from "@/server/ctx";
import { createArtistFor } from "@/server/commands/people";
import { adminAuth } from "@/server/admin";
import { db, run } from "@/server/db";
import { syncClaims } from "@/server/session";
import { isTimeZone, roleIn, type Membership } from "@/schema";
import { DEFAULT_TIME_ZONE } from "@/lib/timezone";

async function main() {
  const args = process.argv.slice(2);
  const zone = args.find((a) => a.startsWith("--time-zone="))?.slice("--time-zone=".length) ?? DEFAULT_TIME_ZONE;
  if (!isTimeZone(zone)) throw new Error(`Not a time zone: ${zone} (use an IANA name like America/Chicago)`);
  const want = args.find((a) => a.startsWith("--artist="))?.slice("--artist=".length);
  const [email, name0, artistName] = args.filter((a) => !a.startsWith("--"));
  const name = name0 || email?.split("@")[0];
  if (!email || !email.includes("@")) throw new Error('Usage: tsx scripts/bootstrap-admin.ts <google-email> "<Name>" ["<Artist name>" | --artist=<slug>]');
  if (!process.env.GCLOUD_PROJECT) throw new Error("Set GCLOUD_PROJECT (e.g. roadie-prod-iab)");

  const sys = systemCtx("bootstrap-admin");
  const artists = await db.list(sys, "artists");
  let artist = want ? artists.find((a) => a.slug === want) : artists.length === 1 ? artists[0] : undefined;
  if (want && !artist) throw new Error(`No artist with slug ${want}`);
  if (!artist && artists.length > 1) throw new Error(`There are ${artists.length} artists: say which with --artist=<slug> (${artists.map((a) => a.slug).join(", ")})`);
  if (!artist) {
    if (!artistName) throw new Error('No artist yet: pass its name as the third argument, e.g. "Nora Quill Band"');
    // No artist yet to act as: the same steps sign-up takes (a person with no artist). The admin is added below.
    const input = registry["artists.create"].input.parse({ name: artistName, timeZone: zone, configurations: [] });
    const r = await run(personCtx("bootstrap", email, "import"), (w) => createArtistFor(w, "bootstrap", input as Record<string, unknown> & { name: string }));
    artist = (await db.get(sys, "artists", r.id))!;
    console.log(`Created artist ${artistName} (/artists/${r.slug}).`);
  }

  const ctx = importCtx(artist.id, "bootstrap");
  const [existing] = await db.list(sys, "users", (q) => q.where("email", "==", email.toLowerCase()).limit(1));
  if (!existing || !roleIn(existing, artist.id)) {
    const add = registry["users.add"];
    await add.run(ctx, add.input.parse({ email, name, role: "admin" }));
  } else if (roleIn(existing, artist.id) !== "admin") {
    const artistsField = ((existing.artists ?? []) as Membership[]).map((m) => (m.artistId === artist!.id ? { ...m, role: "admin" } : m));
    await db.update(ctx, "users", existing.id, { artists: artistsField });
  }
  const user = await adminAuth().getUserByEmail(email.toLowerCase());
  await syncClaims(user.uid);
  console.log(`Admin ready: ${email} (uid ${user.uid}) for ${artist.name} (/artists/${artist.slug}) in project ${process.env.GCLOUD_PROJECT}. Sign in with Google.`);
}
main().then(() => process.exit(0), (e) => { console.error(e.message ?? e); process.exit(1); });
