/**
 * Sign-up notices for platform admins: the "New artist on Roadie" email (src/server/newArtistNotice.ts), sent from the first
 * platform admin with a Gmail grant and never failing the creation; and Admin › Platform's artist list with Suspend
 * (platform.artists, platform.suspend), platform admins only.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { startAll } from "../../fakes/run-all";
import { POST as signUpPost } from "@/app/api/sign-up/route";
import { adminAuth, firestore } from "@/server/admin";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { gmailClient } from "@/server/integrations";
import { FEATURE_SCOPES } from "@/server/google/oauth";
import { isExcluded } from "@/server/assistant/policy";
import { mcpCommands } from "../../mcp/tools";
import { resetEmulators, makeUser, makeArtist, makePlatformAdmins, allowNewArtists, idToken, SYS, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let gmailUrl: string;
let jeff: Ctx, olga: Ctx;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  gmailUrl = s.running["fake-gmail"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

/** A Gmail grant for this person (what Settings > Google saves); the fake Gmail needs no token, only the grant's existence. */
const grantGmail = (uid: string, email: string) => firestore().doc(`googleGrants/${uid}`).set({
  uid, emails: [email], googleEmail: email, scopes: FEATURE_SCOPES.gmail, refreshToken: "sealed", connectedAt: new Date(), updatedAt: new Date(),
});

beforeEach(async () => {
  process.env.GMAIL_BASE_URL = gmailUrl;
  await resetEmulators();
  await fetch(`${gmailUrl}/__reset`, { method: "POST" });
  await allowNewArtists();
  await makeArtist("Test Band", "test-band");
  const j = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  const o = await makeUser("olga@example.com", "admin", { name: "Olga" });
  await makePlatformAdmins(j.uid);
  jeff = { uid: j.uid, role: "admin", artistId: TEST_ARTIST, via: "app", runId: newRunId() };
  olga = { uid: o.uid, role: "admin", artistId: TEST_ARTIST, via: "app", runId: newRunId() };
});

const cmd = async (name: string, input: unknown, c: Ctx) => {
  const x = registry[name];
  return (await x.run({ ...c, runId: newRunId() }, x.input.parse(input))) as Record<string, any>;
};
const sent = () => gmailClient(gmailUrl).listMessages();
const signUp = async (email: string, name: string, body: unknown) => {
  const u = await adminAuth().createUser({ email, emailVerified: true, displayName: name });
  const res = await signUpPost(new NextRequest("http://localhost/api/sign-up", { method: "POST", headers: { authorization: `Bearer ${await idToken(u.uid)}` }, body: JSON.stringify(body) }));
  const json = (await res.json()) as { slug: string };
  const made = res.status === 200 ? (await firestore().collection("artists").where("slug", "==", json.slug).get()).docs[0]?.id : undefined;
  return { uid: u.uid, status: res.status, json: { ...json, id: made ?? "" } };
};

test("platform.artists and platform.suspend: a non-platform-admin is refused; neither is offered to Roadie or MCP", async () => {
  for (const [name, input] of [["platform.artists", {}], ["platform.suspend", { artistId: TEST_ARTIST, suspended: true }]] as const) {
    await assert.rejects(cmd(name, input, olga), (e: any) => e.status === 403 && e.code === "forbidden");
    assert.equal(isExcluded(name), true);
    assert.ok(!mcpCommands().some((c) => c.name === name));
  }
  assert.equal((await firestore().doc(`platformArtists/${TEST_ARTIST}`).get()).exists, false);
});

test("a sign-up emails every platform admin from the first one with a Gmail grant", async () => {
  const ingrid = await makeUser("ingrid@example.com", "admin", { name: "Ingrid" });
  await makePlatformAdmins(ingrid.uid);
  await grantGmail(ingrid.uid, "ingrid@gmail.example"); // Jeff (first) has no grant: Ingrid's sends it
  const r = await signUp("pat@example.com", "Pat Stranger", { name: "The Night Owls", timeZone: "America/New_York" });
  assert.equal(r.status, 200);
  const mail = await sent();
  assert.equal(mail.length, 1);
  const m = mail[0];
  assert.equal(m.account, "ingrid@gmail.example");
  assert.deepEqual([...m.to].sort(), ["ingrid@example.com", "jeff@example.com"]);
  assert.equal(m.subject, "New artist on Roadie: The Night Owls");
  assert.match(m.body, /Pat Stranger \(pat@example\.com\) just started The Night Owls on Roadie through sign-up/);
  assert.match(m.body, /Time zone: America\/New_York/);
  assert.match(m.body, /New artists today \(UTC\): 1 of 1000/);
  assert.match(m.body, /\/artists\/test-band\/admin\/platform/);
});

test("artists.create emails too; with no Gmail grant nothing is sent and the artist is made", async () => {
  const a = await cmd("artists.create", { name: "No Grant Band", configurations: [] }, olga);
  assert.ok(a.id);
  assert.equal((await sent()).length, 0);
  await grantGmail(jeff.uid, "jeff@example.com");
  const b = await cmd("artists.create", { name: "Second Band", configurations: [] }, olga);
  const mail = await sent();
  assert.equal(mail.length, 1);
  assert.match(mail[0].body, /Olga \(olga@example\.com\) just started Second Band on Roadie with New artist/);
  assert.match(mail[0].body, /Time zone: America\/Denver/);
  assert.ok(await db.get(SYS, "artists", b.id));
});

test("an email failure never fails creation: sign-up and artists.create still make the artist", async () => {
  await grantGmail(jeff.uid, "jeff@example.com");
  process.env.GMAIL_BASE_URL = "http://127.0.0.1:9"; // nothing listens: every send fails
  const r = await signUp("pat@example.com", "Pat Stranger", { name: "The Night Owls" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await db.get(SYS, "artists", r.json.id))?.name, "The Night Owls");
  const c = await cmd("artists.create", { name: "Still Made", configurations: [] }, olga);
  assert.equal((await db.get(SYS, "artists", c.id))?.name, "Still Made");
});

test("platform.artists: newest first, creator, today's usage against the limits, flags; suspend and unsuspend", async () => {
  const older = await cmd("artists.create", { name: "Older Band", configurations: [] }, olga);
  const newer = await signUp("pat@example.com", "Pat Stranger", { name: "Newer Band", timeZone: "America/New_York" });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  await firestore().doc(`usage/${newer.json.id}_${today}`).set({ roadieMessages: 12, maps: 3 });
  await firestore().doc(`platformArtists/${older.id}`).set({ exempt: true });

  const list = await cmd("platform.artists", {}, jeff);
  const ids = list.artists.map((a: { id: string }) => a.id);
  assert.deepEqual(ids.slice(0, 2), [newer.json.id, older.id]);
  assert.ok(ids.includes(TEST_ARTIST));
  const n = list.artists[0];
  assert.equal(n.name, "Newer Band");
  assert.deepEqual(n.creator, { uid: newer.uid, name: "Pat Stranger", email: "pat@example.com" });
  assert.equal(n.timeZone, "America/New_York");
  assert.equal(n.usageDate, today);
  assert.deepEqual(n.usage, { roadieMessages: 12, webLookups: 0, transcriptions: 0, imageReads: 0, maps: 3, publicMaps: 0 });
  assert.deepEqual({ exempt: n.exempt, suspendedAt: n.suspendedAt }, { exempt: false, suspendedAt: null });
  assert.equal(list.artists[1].exempt, true);
  assert.equal(list.limits.roadieMessages, 300);
  assert.equal(list.newArtistsPerDay, 1000);

  // Suspend: platformArtists/{id}.suspendedAt, and the member's claims drop it.
  await cmd("platform.suspend", { artistId: newer.json.id, suspended: true }, jeff);
  assert.ok((await firestore().doc(`platformArtists/${newer.json.id}`).get()).get("suspendedAt"));
  const claims = async () => JSON.stringify((await adminAuth().getUser(newer.uid)).customClaims ?? {});
  assert.ok(!(await claims()).includes(newer.json.id));
  assert.ok((await cmd("platform.artists", {}, jeff)).artists[0].suspendedAt);
  await cmd("platform.suspend", { artistId: newer.json.id, suspended: false }, jeff);
  assert.equal((await firestore().doc(`platformArtists/${newer.json.id}`).get()).get("suspendedAt"), undefined);
  assert.ok((await claims()).includes(newer.json.id));

  // Not the artist you're working in, and not one that doesn't exist.
  await assert.rejects(cmd("platform.suspend", { artistId: TEST_ARTIST, suspended: true }, jeff), (e: any) => e.status === 400);
  await assert.rejects(cmd("platform.suspend", { artistId: "nope", suspended: true }, jeff), (e: any) => e.status === 404);
});
