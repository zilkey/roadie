/**
 * Artists get URL names and people get per-artist roles:
 *   tsx scripts/migrate-artists.ts [--dry-run] [--yes]
 * 1. Every artist without a `slug` gets one from its name ("Ingrid Avison Band" -> "ingrid-avison-band"; "-2", "-3"... when taken).
 * 2. Every user with the old single `role` (and no `artists`) becomes a member of the one artist with that role:
 *    `artists: [{artistId, role}]`, and `role` is dropped. With several artists and no memberships to go on, it refuses
 *    (say which artist with --artist=<id>).
 * 3. Custom claims are re-set for every live user ({artists: {artistId: role}, musicianId}), so Firestore rules see the
 *    new shape without waiting for the next sign-in.
 * Live docs are written through the normal writer (history + rev, via "import"); soft-deleted users are fixed in place.
 * Safe to run again: it only touches docs still in the old shape. Against real Firestore (no emulator host) it needs --yes.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { db } from "@/server/db";
import { syncClaims } from "@/server/session";
import { ArtistRole, slugForArtist } from "@/schema";

export interface MigrateArtistsResult {
  slugs: { id: string; name: string; slug: string }[];
  users: { id: string; email: string; artistId: string; role: string }[];
  claims: number;
}

export async function migrateArtists(fs: Firestore, opts: { dryRun?: boolean; artistId?: string } = {}): Promise<MigrateArtistsResult> {
  const ctx = importCtx("migrate-artists");
  const artists = (await fs.collection("artists").get()).docs.map((d) => ({ id: d.id, ...d.data() }) as { id: string; name?: string; slug?: string; deletedAt?: unknown });
  const taken = new Set(artists.map((a) => a.slug).filter((s): s is string => typeof s === "string"));
  const slugs: MigrateArtistsResult["slugs"] = [];
  for (const a of artists.filter((x) => typeof x.slug !== "string")) {
    const base = slugForArtist(a.name ?? a.id);
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    slugs.push({ id: a.id, name: a.name ?? "", slug });
    if (opts.dryRun) continue;
    if (a.deletedAt) await fs.collection("artists").doc(a.id).update({ slug });
    else await db.update(ctx, "artists", a.id, { slug });
  }

  const liveArtists = artists.filter((a) => !a.deletedAt);
  const target = opts.artistId ?? (liveArtists.length === 1 ? liveArtists[0].id : undefined);
  if (opts.artistId && !artists.some((a) => a.id === opts.artistId)) throw new Error(`No artist ${opts.artistId}`);
  const users = (await fs.collection("users").get()).docs.map((d) => ({ id: d.id, ...d.data() }) as { id: string; email?: string; role?: unknown; artists?: unknown; deletedAt?: unknown });
  const old = users.filter((u) => !Array.isArray(u.artists));
  if (old.length && !target) {
    throw new Error(`${old.length} user(s) have no artist memberships and there are ${liveArtists.length} artists: re-run with --artist=<id>`);
  }
  const moved: MigrateArtistsResult["users"] = [];
  for (const u of old) {
    const role = ArtistRole.safeParse(u.role).success ? (u.role as string) : "member";
    moved.push({ id: u.id, email: u.email ?? "", artistId: target!, role });
    if (opts.dryRun) continue;
    const artistsField = [{ artistId: target!, role }];
    if (u.deletedAt) await fs.collection("users").doc(u.id).update({ artists: artistsField, role: FieldValue.delete() });
    else await db.update(ctx, "users", u.id, { artists: artistsField, role: null });
  }

  let claims = 0;
  if (!opts.dryRun) {
    for (const u of users) {
      if (u.deletedAt) continue;
      try { await syncClaims(u.id); claims++; } catch (e) {
        // A users doc without an Auth account (never signed in through Google) has nothing to set.
        if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
      }
    }
  }
  return { slugs, users: moved, claims };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const artistId = process.argv.find((a) => a.startsWith("--artist="))?.slice("--artist=".length);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await migrateArtists(firestore(), { dryRun: flag("dry-run"), artistId });
  const verb = flag("dry-run") ? "Would set" : "Set";
  for (const s of r.slugs) console.log(`${verb} artist ${s.id} (${s.name}) slug: ${s.slug}`);
  for (const u of r.users) console.log(`${verb} user ${u.email || u.id}: ${u.role} of ${u.artistId}`);
  console.log(`${r.slugs.length} artist slug(s), ${r.users.length} user(s) moved to memberships${flag("dry-run") ? "" : `, claims re-set for ${r.claims} user(s)`}.`);
}

if (process.argv[1]?.endsWith("migrate-artists.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
