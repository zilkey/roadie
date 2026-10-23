import { adminAuth } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { db } from "@/server/db";

const fsHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8280";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9319";
const project = "demo-band-tracker";

export async function resetEmulators() {
  await fetch(`http://${fsHost}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${authHost}/emulator/v1/projects/${project}/accounts`, { method: "DELETE" });
}

/** Create an auth user + users doc + claims, return an ID token. */
export async function makeUser(email: string, role: "admin" | "member", opts: { musicianId?: string; name?: string } = {}) {
  const u = await adminAuth().createUser({ email, emailVerified: true, displayName: opts.name ?? email });
  await db.create(importCtx(), "users", { email, name: opts.name ?? email, role, mcpAccess: false, musicianId: opts.musicianId }, { id: u.uid });
  await adminAuth().setCustomUserClaims(u.uid, { role, ...(opts.musicianId ? { musicianId: opts.musicianId } : {}) });
  return { uid: u.uid, token: await idToken(u.uid) };
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
  name, type: "bar", address: { city, state: "CO" }, region: "denver", contactIds: [], promoterIds: [], ...extra,
});
