/**
 * Seed the REAL Ingrid Avison Band into an empty project: the artist, the five musicians, their logins and claims,
 * the five configurations, and the default checklist/email templates. No demo data at all -- the venues, shows, songs
 * and money come from the story 04/05 imports.
 *
 *   GCLOUD_PROJECT=demo-band-tracker FIRESTORE_EMULATOR_HOST=127.0.0.1:8280 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9319 \
 *     tsx scripts/seed-real.ts --dry-run          (reports what it would create, writes nothing)
 *   ... same env, then:  tsx scripts/seed-real.ts  (emulator: writes)
 *   GCLOUD_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS=./key.json \
 *     tsx scripts/seed-real.ts --yes              (real Firestore needs --yes)
 *
 * scripts/seed.ts stays the DEMO seed: it hardcodes demo-band-tracker, resets through the emulator-only HTTP
 * endpoint, and builds Front Range sample data around DEV_PEOPLE's fake @example.com addresses, which npm run e2e
 * depends on. This script shares its helpers (seedTemplates) but none of its data.
 *
 * People go through the same path scripts/bootstrap-admin.ts uses -- the real users.add command, then syncClaims --
 * rather than writing `users` docs directly: the claims are what make sign-in work and the command already gets
 * them right.
 *
 * Idempotent: the artist is found by its fixed slug, people by email. A second run creates nothing and only makes
 * sure of each role, so it is safe to run twice (and story 02 says to, to prove it).
 *
 * Guard rails, the same shape as the other scripts here:
 *   - refuses without GCLOUD_PROJECT, so it can't silently hit the demo project;
 *   - real Firestore (no emulator host) needs --yes;
 *   - --dry-run reports and writes nothing.
 */
import { registry } from "@/server/commands/registry";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { adminAuth } from "@/server/admin";
import { db, type Doc } from "@/server/db";
import { syncClaims } from "@/server/session";
import { slugForArtist } from "@/schema/artists";
import { roleIn, type Membership } from "@/schema";
import { requireRoster, type BandRoster } from "@/lib/band-roster";
import { seedEmailTemplates } from "./seed";

export interface SeedRealResult {
  /** The artist's id and slug, and whether this run created it. */
  artist: { id: string; slug: string; created: boolean };
  /** One line per person: what this run did to them. "role" means they were already there with the wrong role. */
  people: { email: string; name: string; role: "admin" | "member"; action: "created" | "role" | "unchanged" }[];
  /** Checklist templates the artist now has (0 on a second run: it already had them, and none were added). */
  templates: number;
  /** Nothing was written. */
  dryRun: boolean;
}

/** The artist slug is fixed, so a second run finds the same artist rather than making "<name>-2". */
export const bandSlug = (roster: BandRoster) => slugForArtist(roster.BAND_ARTIST_NAME);

/** The configurations with each key resolved to a real musician record id. Keys with no record yet are left out. */
const configurationsFor = (roster: BandRoster, musicianIds: Record<string, string>) =>
  roster.BAND_CONFIGURATIONS.map(({ id, name, billingName, keys }) => ({
    id, name, billingName, musicianIds: keys.map((k) => musicianIds[k]).filter(Boolean),
  }));

/**
 * Create the artist (or find the one already there, by slug) with the real links.
 *
 * The configurations start empty and are filled by seedReal once the people exist: they name musician record ids,
 * and on a fresh project no musician exists yet -- but the people have to be added TO an artist, so the artist is
 * necessarily first.
 *
 * driveFolderId is "": the real Drive folder is chosen in the app (Settings > Google > Band folder), and a fake id here would make the Music
 * tab's sharing checks lie.
 */
async function ensureArtist(ctx: Ctx, roster: BandRoster, dryRun: boolean) {
  const slug = bandSlug(roster);
  const [existing] = await db.list("artists", (q) => q.where("slug", "==", slug).limit(1));
  if (existing) {
    // An artist seeded before the Signal group setting existed picks it up; one set from the app is left alone.
    if (roster.BAND_SIGNAL_GROUP_URL && !existing.signalGroupUrl && !dryRun) {
      const update = registry["artists.update"];
      await update.run(ctx, update.input.parse({ id: existing.id, patch: { signalGroupUrl: roster.BAND_SIGNAL_GROUP_URL } }));
    }
    return { id: existing.id, slug: existing.slug as string, created: false };
  }
  if (dryRun) return { id: "(dry-run)", slug, created: true };
  const create = registry["artists.create"];
  const r = (await create.run(ctx, create.input.parse({
    name: roster.BAND_ARTIST_NAME, slug, configurations: [], links: roster.BAND_LINKS, driveFolderId: "",
    ...(roster.BAND_SIGNAL_GROUP_URL ? { signalGroupUrl: roster.BAND_SIGNAL_GROUP_URL } : {}),
  }))) as { id: string; slug: string };
  return { id: r.id, slug: r.slug, created: true };
}

/**
 * Give one person their Auth user + users/{uid} doc + claims for this artist, through users.add -- bootstrap-admin's
 * path. Already a member: only the role is made sure of, so a second run changes nothing.
 */
async function ensurePerson(ctx: Ctx, artistId: string, p: BandRoster["BAND_PEOPLE"][number], dryRun: boolean) {
  const email = p.email.toLowerCase();
  const [existing] = await db.list("users", (q) => q.where("email", "==", email).limit(1));
  const current = existing ? roleIn(existing, artistId) : "";
  const action = !existing || !current ? "created" : current === p.role ? "unchanged" : "role";
  if (dryRun || action === "unchanged") return { email, name: p.name, role: p.role, action } as const;

  if (action === "created") {
    const add = registry["users.add"];
    // `musician` makes the Band Member record and links it to the login in the same command.
    await add.run(ctx, add.input.parse({ email, name: p.name, role: p.role, musician: { instruments: p.instruments } }));
  } else {
    const artists = ((existing!.artists ?? []) as Membership[]).map((m) =>
      m.artistId === artistId ? { ...m, role: p.role, ...(p.role === "admin" ? { mcpAccess: m.mcpAccess ?? false } : {}) } : m);
    await db.update(ctx, "users", existing!.id, { artists });
  }
  const user = await adminAuth().getUserByEmail(email);
  await syncClaims(user.uid);
  return { email, name: p.name, role: p.role, action } as const;
}

/** The musician record ids of the people now in this project, keyed by BAND_PEOPLE key (for the configurations). */
async function musicianIdsByKey(roster: BandRoster): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const musicians = await db.list("musicians");
  for (const p of roster.BAND_PEOPLE) {
    const m = musicians.find((x: Doc) => (x.email as string | undefined)?.toLowerCase() === p.email.toLowerCase());
    if (m) out[p.key] = m.id;
  }
  return out;
}

export async function seedReal(opts: { dryRun?: boolean; runId?: string } = {}): Promise<SeedRealResult> {
  const dryRun = !!opts.dryRun;
  const runId = opts.runId ?? newRunId();
  const roster = await requireRoster();

  // The artist first: people are added to it. Its configurations are filled in below, once they name real records.
  const ctx = importCtx("seed-real", runId);
  const artist = await ensureArtist(ctx, roster, dryRun);

  const bandCtx = importCtx("seed-real", runId, artist.id);
  const people: SeedRealResult["people"] = [];
  for (const p of roster.BAND_PEOPLE) people.push(await ensurePerson(bandCtx, artist.id, p, dryRun));

  // Every musician record exists now, so the configurations can name them. db.update writes nothing when the
  // configurations already match, which is what makes a second run a no-op here.
  if (!dryRun) await db.update(bandCtx, "artists", artist.id, { configurations: configurationsFor(roster, await musicianIdsByKey(roster)) });

  // artists.create has already seeded this artist's checklist templates (Promo, Follow Up), so only the email
  // templates are left to add -- and only for a fresh artist, or a second run would stack a duplicate set.
  let templates = 0;
  if (!dryRun && artist.created) {
    const create = async (path: string, doc: Record<string, unknown>, id?: string) =>
      (await db.create(bandCtx, path, doc, id ? { id } : undefined)).id;
    await seedEmailTemplates(create);
    templates = (await db.list("checklistTemplates", (q) => q.where("artistId", "==", artist.id))).length;
  }

  return { artist, people, templates, dryRun };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const project = process.env.GCLOUD_PROJECT;
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (!project) throw new Error("Set GCLOUD_PROJECT (e.g. roadie-prod-iab), so this can't silently hit the demo project.");

  const dryRun = flag("dry-run");
  console.log(`Target: ${project} (${emulator ? `emulator at ${emulator}` : "REAL Firestore"})`);
  if (!dryRun && !emulator && !flag("yes")) throw new Error(`Seeding REAL Firestore (${project}) needs --yes. Nothing written.`);

  const r = await seedReal({ dryRun });
  const verb = dryRun ? "Would create" : "Created";
  const roster = await requireRoster();
  console.log(`${r.artist.created ? verb : "Found"} artist ${roster.BAND_ARTIST_NAME} (/artists/${r.artist.slug}) with ${roster.BAND_CONFIGURATIONS.length} configurations and ${Object.keys(roster.BAND_LINKS).length} links.`);
  for (const p of r.people) {
    const what = p.action === "created" ? `${verb.toLowerCase()} as ${p.role}` : p.action === "role" ? `set to ${p.role}` : `already ${p.role}`;
    console.log(`  ${p.name} <${p.email}>: ${what}`);
  }
  if (r.templates) console.log(`${verb} ${r.templates} checklist template(s) plus the default email templates.`);
  console.log(dryRun ? "(dry run, nothing written)" : "No demo data: venues, shows, songs and money come from the imports.");
}

if (process.argv[1]?.endsWith("seed-real.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
