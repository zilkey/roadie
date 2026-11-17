import { adminAuth } from "@/server/admin";
import { importCtx, systemCtx } from "@/server/ctx";
import { db } from "@/server/db";
import { startSession, syncClaims } from "@/server/session";
import { addPlatformAdmins, approveEditor } from "@/server/platform";

const fsHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8280";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9319";
// Each test file has its own project (tests/emulator/setup.mjs), so files can run in parallel on one emulator.
const project = process.env.GCLOUD_PROJECT ?? "demo-band-tracker";

export async function resetEmulators() {
  await fetch(`http://${fsHost}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${authHost}/emulator/v1/projects/${project}/accounts`, { method: "DELETE" });
}

/** The artist test users belong to unless they say otherwise (no artists doc is needed for commands to accept it). */
export const TEST_ARTIST = "test-artist";
/** Unscoped reads and writes for test setup and assertions (tests see every artist's records). */
export const SYS = systemCtx("test");

/** Create an auth user + users doc (a member of `artistId`, default TEST_ARTIST) + claims, return an ID token. */
export async function makeUser(email: string, role: "admin" | "member" | "ai", opts: { musicianId?: string; name?: string; artistId?: string; artists?: { artistId: string; role: "admin" | "member" | "ai"; musicianId?: string }[] } = {}) {
  const u = await adminAuth().createUser({ email, emailVerified: true, displayName: opts.name ?? email });
  // The musician is linked on the membership (Membership.musicianId), as users.add does since tenancy phase 4.
  const artists = opts.artists ?? [{ artistId: opts.artistId ?? TEST_ARTIST, role, ...(opts.musicianId ? { musicianId: opts.musicianId } : {}) }];
  await db.create(SYS, "users", { email, name: opts.name ?? email, artists }, { id: u.uid });
  await syncClaims(u.uid);
  return { uid: u.uid, token: await idToken(u.uid) };
}

/** An artists doc (default id TEST_ARTIST) with a slug. */
export async function makeArtist(name: string, slug: string, id = TEST_ARTIST, timeZone = "America/Denver") {
  await db.create(importCtx(id), "artists", { name, slug, timeZone, configurations: [], links: {}, driveFolderId: "" }, { id });
  return id;
}

export async function idToken(uid: string) {
  const custom = await adminAuth().createCustomToken(uid);
  const res = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo`, {
    // Without a project in the request the Auth emulator signs in to its default project, not this file's own
    // (setup.mjs). targetProjectId names it, and the emulator only takes that from an "owner" request.
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer owner" },
    body: JSON.stringify({ token: custom, returnSecureToken: true, targetProjectId: project }),
  });
  return ((await res.json()) as { idToken: string }).idToken;
}

export const venue = (name: string, city = "Denver", extra: Record<string, unknown> = {}) => ({
  name, type: "bar", address: { city, state: "CO" }, region: "denver", ...extra,
});

/** startSession for someone who belongs to a band (fails the test on a "noBand" answer). */
export async function readySession(authHeader: string) {
  const s = await startSession(authHeader);
  if (s.status !== "ready") throw new Error(`expected a ready session, got ${s.status}`);
  return s;
}

/**
 * Approve people to change shared records (venues, acts, promoters, festivals, editions, venue types): tenancy phase 1. Tests that
 * write the shared directory as a band person call this for them, like the real band is approved on prod.
 */
export async function approveTestEditors(...uids: string[]) {
  for (const uid of uids) await approveEditor(uid, "test");
}

/** Make people platform admins (platform/admins): merge and remove shared entries, approve editors. */
export async function makePlatformAdmins(...uids: string[]) {
  await addPlatformAdmins(uids);
}
