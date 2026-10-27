import { adminAuth } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { db } from "@/server/db";
import { startSession, syncClaims } from "@/server/session";

const fsHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8280";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9319";
const project = "demo-band-tracker";

export async function resetEmulators() {
  await fetch(`http://${fsHost}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${authHost}/emulator/v1/projects/${project}/accounts`, { method: "DELETE" });
}

/** The artist test users belong to unless they say otherwise (no artists doc is needed for commands to accept it). */
export const TEST_ARTIST = "test-artist";

/** Create an auth user + users doc (a member of `artistId`, default TEST_ARTIST) + claims, return an ID token. */
export async function makeUser(email: string, role: "admin" | "member" | "ai", opts: { musicianId?: string; name?: string; artistId?: string; artists?: { artistId: string; role: "admin" | "member" | "ai" }[] } = {}) {
  const u = await adminAuth().createUser({ email, emailVerified: true, displayName: opts.name ?? email });
  const artists = opts.artists ?? [{ artistId: opts.artistId ?? TEST_ARTIST, role }];
  await db.create(importCtx(), "users", { email, name: opts.name ?? email, artists, mcpAccess: role === "ai", musicianId: opts.musicianId }, { id: u.uid });
  await syncClaims(u.uid);
  return { uid: u.uid, token: await idToken(u.uid) };
}

/** An artists doc (default id TEST_ARTIST) with a slug. */
export async function makeArtist(name: string, slug: string, id = TEST_ARTIST) {
  await db.create(importCtx(), "artists", { name, slug, configurations: [], links: {}, driveFolderId: "" }, { id });
  return id;
}

export async function idToken(uid: string) {
  const custom = await adminAuth().createCustomToken(uid);
  const res = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
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
