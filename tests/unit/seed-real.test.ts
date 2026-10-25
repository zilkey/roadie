import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { db, type Doc } from "@/server/db";
import { adminAuth } from "@/server/admin";
import { dumpAll } from "@/server/backup";
import { firestore } from "@/server/admin";
import { roleIn } from "@/schema";
import { ARTIST_LINKS } from "@/schema/artists";
import { requireRoster } from "@/lib/band-roster";
import { bandSlug, seedReal } from "../../scripts/seed-real";
import { resetEmulators } from "./helpers";

// The roster is src/lib/band.ts, which is gitignored (real names and addresses stay out of the repo), so the
// assertions below are written against whatever it holds rather than against literal addresses. It is loaded in
// before() rather than at module level: tsx compiles these tests as CJS, which has no top-level await.
let roster: Awaited<ReturnType<typeof requireRoster>>;
let BAND_ARTIST_NAME: string, BAND_CONFIGURATIONS: typeof roster.BAND_CONFIGURATIONS, BAND_LINKS: typeof roster.BAND_LINKS, BAND_PEOPLE: typeof roster.BAND_PEOPLE;
let BAND_SLUG: string, adminEmails: string[];
const emailOf = (key: string) => BAND_PEOPLE.find((p) => p.key === key)!.email;

before(async () => {
  roster = await requireRoster();
  ({ BAND_ARTIST_NAME, BAND_CONFIGURATIONS, BAND_LINKS, BAND_PEOPLE } = roster);
  BAND_SLUG = bandSlug(roster);
  adminEmails = BAND_PEOPLE.filter((p) => p.role === "admin").map((p) => p.email).sort();
});

beforeEach(resetEmulators);

const artist = async () => (await db.list("artists", (q) => q.where("slug", "==", BAND_SLUG).limit(1)))[0];
const userByEmail = async (email: string) => (await db.list("users", (q) => q.where("email", "==", email).limit(1)))[0];
const configOf = (a: Doc, id: string) =>
  (a.configurations as { id: string; name: string; billingName: string; musicianIds: string[] }[]).find((c) => c.id === id)!;

test("all five people are created with the right roles, claims, and linked band member records", async () => {
  const r = await seedReal();
  const a = await artist();
  assert.ok(a, "the artist was created");
  assert.equal(a.name, BAND_ARTIST_NAME);
  assert.equal(r.artist.created, true);

  // The real five, and nobody else: no DEV_PEOPLE, no demo "Sam".
  const users = await db.list("users");
  const musicians = await db.list("musicians");
  assert.equal(users.length, 5, "five logins");
  assert.equal(musicians.length, 5, "five band members, no demo extras");

  for (const p of BAND_PEOPLE) {
    const u = await userByEmail(p.email);
    assert.ok(u, `${p.email} has a login`);
    assert.equal(u.name, p.name);
    assert.equal(roleIn(u, a.id), p.role, `${p.name} is ${p.role}`);

    // The Auth user exists and its claims carry this artist's role: the claims are what make sign-in work.
    const authUser = await adminAuth().getUserByEmail(p.email);
    assert.equal(u.id, authUser.uid, "the users doc id is the Auth uid");
    const claims = (authUser.customClaims ?? {}) as { artists?: Record<string, string> };
    assert.equal(claims.artists?.[a.id], p.role, `${p.name}'s claims say ${p.role} in this artist`);

    // ...and a Band Member record with their instruments, linked both ways.
    const m = musicians.find((x) => x.email === p.email)!;
    assert.ok(m, `${p.name} is a band member`);
    assert.deepEqual(m.instruments, p.instruments);
    assert.equal(m.userId, u.id);
    assert.equal(u.musicianId, m.id);
    assert.equal(m.active, true);
  }

  // Exactly the two admins the roster names.
  const admins = (await db.list("users")).filter((u) => roleIn(u, a.id) === "admin").map((u) => u.email).sort();
  assert.deepEqual(admins, adminEmails);
  assert.equal(adminEmails.length, 2, "the roster names exactly two admins");
  assert.equal(r.people.filter((p) => p.action === "created").length, 5);

  // Addresses are stored exactly as the roster gives them (an address that reads like a typo may be the real one).
  for (const p of BAND_PEOPLE) {
    assert.equal((await userByEmail(p.email)).name, p.name);
  }
});

test("a second run creates nothing and changes nothing", async () => {
  await seedReal();
  const before = await dumpAll(firestore());
  const authBefore = (await adminAuth().listUsers(50)).users.map((u) => ({ uid: u.uid, email: u.email, claims: u.customClaims })).sort((x, y) => x.uid.localeCompare(y.uid));

  const second = await seedReal();

  assert.equal(second.artist.created, false, "the fixed slug found the artist that is already there");
  assert.deepEqual(second.people.map((p) => p.action), ["unchanged", "unchanged", "unchanged", "unchanged", "unchanged"]);
  assert.equal(second.templates, 0, "no second set of templates");
  assert.equal((await db.list("checklistTemplates")).length, 2, "Promo and Follow Up are not doubled");
  assert.equal((await db.list("emailTemplates")).length, 3, "the email templates are not doubled");

  // Byte-for-byte: no new documents, no new history entries, no re-stamped updatedAt.
  assert.deepEqual(await dumpAll(firestore()), before, "the second run wrote nothing at all");
  const authAfter = (await adminAuth().listUsers(50)).users.map((u) => ({ uid: u.uid, email: u.email, claims: u.customClaims })).sort((x, y) => x.uid.localeCompare(y.uid));
  assert.deepEqual(authAfter, authBefore, "the same Auth users with the same claims");
  assert.equal((await db.list("artists")).length, 1, "no ingrid-avison-band-2");
});

test("a second run makes sure of a role that was changed by hand", async () => {
  await seedReal();
  const a = await artist();
  const david = await userByEmail(emailOf("david"));
  // Somebody made David an admin in the console: the seed is the source of truth for roles, so it puts it back.
  await db.update({ uid: "tester", role: "admin", via: "import", runId: "by-hand", artistId: a.id }, "users", david.id, {
    artists: [{ artistId: a.id, role: "admin", mcpAccess: false }],
  });
  assert.equal(roleIn(await userByEmail(emailOf("david")), a.id), "admin");

  const r = await seedReal();
  assert.equal(r.people.find((p) => p.email === emailOf("david"))!.action, "role");
  assert.equal(roleIn(await userByEmail(emailOf("david")), a.id), "member", "back to member");
  const claims = ((await adminAuth().getUserByEmail(emailOf("david"))).customClaims ?? {}) as { artists?: Record<string, string> };
  assert.equal(claims.artists?.[a.id], "member", "the claims were re-synced, not left stale");
  // The other four were not touched.
  assert.deepEqual(r.people.filter((p) => p.email !== emailOf("david")).map((p) => p.action), ["unchanged", "unchanged", "unchanged", "unchanged"]);
});

test("the artist's links are stored normalized, and unsupported platforms are left out", async () => {
  await seedReal();
  const links = (await artist()).links as Record<string, string>;

  // Stored exactly as the roster gives them...
  assert.deepEqual(links, BAND_LINKS);

  // ...and the roster itself is normalized: https only, no display or tracking parameters, and Spotify is the
  // artist PAGE rather than an album (src/server/integrations/spotify.ts wants an artist id).
  for (const [k, v] of Object.entries(links)) {
    assert.ok(v.startsWith("https://"), `${k} is https, not plain http`);
    assert.ok(!/[?&](si|lang)=/.test(v), `${k} carries no share token or display parameter`);
  }
  if (links.spotify) {
    assert.match(links.spotify, /open\.spotify\.com\/artist\/[A-Za-z0-9]+$/, "the artist page, not an album");
    assert.ok(!links.spotify.includes("/album/"), "not an album link");
  }

  // Only the eleven ARTIST_LINKS keys exist (it is a strict object), so a platform with no key is left out rather
  // than smuggled into website. An unset link shows on the Artist page as one available to add.
  const allowed = new Set(ARTIST_LINKS.map(([k]) => k as string));
  for (const k of Object.keys(links)) assert.ok(allowed.has(k), `${k} is a real ARTIST_LINKS key`);
  assert.ok(!/patreon|distrokid/i.test(JSON.stringify(links)), "platforms with no key are not imported");
  assert.ok(!/patreon|distrokid/i.test(links.website ?? ""), "...nor smuggled into website");
});

test("the five configurations have the right members, and the two reduced ones bill as the full band", async () => {
  await seedReal();
  const a = await artist();
  const musicians = await db.list("musicians");
  const idOf = (key: string) => musicians.find((m) => m.email === emailOf(key))!.id;
  const ingrid = idOf("ingrid"), jeff = idOf("jeff");
  const david = idOf("david"), emma = idOf("emma"), eric = idOf("eric");

  const configs = a.configurations as { id: string; name: string }[];
  assert.equal(configs.length, 5);
  assert.deepEqual(configs.map((c) => c.name), ["Solo", "Duo", "Full Band", "No Lead Guitar", "No Bassist"]);
  // seed.ts's demo four are gone: no trio, no "Ingrid solo".
  assert.ok(!configs.some((c) => /trio/i.test(c.name)), "no demo trio");

  const members = (id: string) => [...configOf(a, id).musicianIds].sort();
  assert.deepEqual(members("solo"), [ingrid].sort());
  assert.deepEqual(members("duo"), [ingrid, jeff].sort());
  assert.deepEqual(members("full-band"), [ingrid, jeff, david, eric, emma].sort());
  assert.deepEqual(members("no-lead-guitar"), [ingrid, jeff, david, eric].sort(), "no Emma");
  assert.deepEqual(members("no-bassist"), [ingrid, jeff, emma, eric].sort(), "no David");

  // Every musician id in every configuration is a real record (not a stale key or an empty slot).
  for (const c of a.configurations as { musicianIds: string[] }[]) {
    for (const id of c.musicianIds) assert.ok(musicians.some((m) => m.id === id), `${id} is a real musician`);
  }

  assert.equal(configOf(a, "solo").billingName, "Ingrid Avison");
  assert.equal(configOf(a, "duo").billingName, "Ingrid Avison Duo");
  // The point of the last two: the audience sees the band either way, so the configuration's own name must not be
  // what gets billed.
  for (const id of ["full-band", "no-lead-guitar", "no-bassist"]) {
    assert.equal(configOf(a, id).billingName, BAND_ARTIST_NAME, `${id} is billed as the full band`);
  }
  assert.notEqual(configOf(a, "no-bassist").billingName, configOf(a, "no-bassist").name, "the configuration name does not leak onto a poster");
});

test("the templates are seeded once, and no demo data is created", async () => {
  const r = await seedReal();
  const a = await artist();

  // Exactly one set of each: artists.create seeds the checklist templates and the script adds only the email ones,
  // so neither Promo/Follow Up nor the email templates are doubled.
  assert.equal(r.templates, 2);
  const checklists = await db.list("checklistTemplates", (q) => q.where("artistId", "==", a.id));
  assert.deepEqual(checklists.map((t) => t.name).sort(), ["Follow Up", "Promo"]);
  assert.deepEqual((await db.list("emailTemplates")).map((t) => t.name).sort(), ["First pitch", "Follow up", "Follow up"]);

  // Stories 04 and 05 import these: the seed must leave them empty.
  for (const col of ["venues", "shows", "songs", "pitches", "setlists", "rehearsals", "expenses", "contacts", "promoters", "festivals", "editions", "showDeals", "availability", "statSnapshots", "files"]) {
    assert.deepEqual(await db.list(col), [], `${col} is empty: no demo data`);
  }
  // A fake Drive id here would make the Music tab's sharing checks lie.
  assert.equal(a.driveFolderId, "");
});

test("a dry run reports what it would create and writes nothing", async () => {
  const before = await dumpAll(firestore());
  const r = await seedReal({ dryRun: true });

  assert.equal(r.dryRun, true);
  assert.equal(r.artist.created, true, "it would create the artist");
  assert.equal(r.artist.slug, BAND_SLUG);
  assert.deepEqual(r.people.map((p) => p.action), ["created", "created", "created", "created", "created"]);
  assert.deepEqual(r.people.map((p) => p.role), BAND_PEOPLE.map((p) => p.role));
  assert.equal(r.templates, 0);

  assert.deepEqual(await dumpAll(firestore()), before, "nothing was written");
  assert.deepEqual(await db.list("artists"), []);
  assert.deepEqual(await db.list("users"), []);
  assert.equal((await adminAuth().listUsers(10)).users.length, 0, "and no Auth users were made");
});

test("a dry run against a seeded project reports it as a no-op", async () => {
  await seedReal();
  const before = await dumpAll(firestore());
  const r = await seedReal({ dryRun: true });
  assert.equal(r.artist.created, false);
  assert.deepEqual(r.people.map((p) => p.action), ["unchanged", "unchanged", "unchanged", "unchanged", "unchanged"]);
  assert.deepEqual(await dumpAll(firestore()), before);
});

test("the CLI refuses without GCLOUD_PROJECT, and refuses real Firestore without --yes", async () => {
  const script = path.join(process.cwd(), "scripts/seed-real.ts");
  const { spawnSync } = await import("node:child_process");
  const { FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, GOOGLE_APPLICATION_CREDENTIALS, ...bare } = process.env;
  // A made-up project id: every assertion is on a guard that throws before firestore() is called, so nothing real is
  // contacted -- and naming a real project here is what the guard exists to make hard.
  const PROJECT = "not-a-real-project-xyz";
  const run = (args: string[], env: Record<string, string> = {}) => {
    const e = { ...bare, ...env } as NodeJS.ProcessEnv;
    if (!("GCLOUD_PROJECT" in env)) delete e.GCLOUD_PROJECT;
    const r = spawnSync("npx", ["tsx", script, ...args], { env: e, encoding: "utf8", timeout: 60_000 });
    return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
  };

  // No GCLOUD_PROJECT: refused, so it can't silently hit the demo project.
  const noProject = run([]);
  assert.notEqual(noProject.code, 0);
  assert.match(noProject.out, /Set GCLOUD_PROJECT/, noProject.out);

  // Real Firestore (no emulator host) without --yes: refused, and the target was named first.
  const noYes = run([], { GCLOUD_PROJECT: PROJECT });
  assert.notEqual(noYes.code, 0);
  assert.match(noYes.out, new RegExp(`Target: ${PROJECT} \\(REAL Firestore\\)`), noYes.out);
  assert.match(noYes.out, /needs --yes/, noYes.out);
  assert.match(noYes.out, /Nothing written/, noYes.out);

  // Nothing reached the emulator either.
  assert.deepEqual(await db.list("artists"), []);
  assert.equal((await adminAuth().listUsers(10)).users.length, 0);
});

test("the emulator does not need --yes", async () => {
  const script = path.join(process.cwd(), "scripts/seed-real.ts");
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync("npx", ["tsx", script], { env: process.env, encoding: "utf8", timeout: 120_000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  assert.equal(r.status, 0, out);
  assert.match(out, /^Target: demo-band-tracker \(emulator at /m, out);
  // Every roster person is named in the summary, whoever they are.
  for (const p of BAND_PEOPLE) assert.ok(out.includes(`${p.name} <${p.email}>`), `${p.name} is in the summary:\n${out}`);
  assert.match(out, /No demo data/, out);
  assert.equal((await db.list("users")).length, 5);
});
