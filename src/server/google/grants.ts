/**
 * Each admin's Google grant at googleGrants/{uid}: their Google address, the scopes granted, and the refresh token,
 * AES-256-GCM encrypted with GOOGLE_TOKEN_KEY. Server-only: firestore.rules has no rule for it, so no client reads it, and
 * nothing here ever returns the token. Written with firebase-admin directly, like routeCache: a secret, not band data,
 * so no history and no undo. Access tokens live only in this process's memory.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { firestore } from "../admin";
import { IntegrationError } from "../integrations/http";
import { featuresOf, GoogleAuthError, refreshAccess, type GoogleFeature, type TokenResponse } from "./oauth";

const COLLECTION = "googleGrants";
const ref = (uid: string) => firestore().doc(`${COLLECTION}/${uid}`);

interface GrantDoc {
  uid: string;
  /** The Roadie sign-in address and the Google address (often the same), lowercased: how Gmail finds the grant for a sender. */
  emails: string[];
  googleEmail: string;
  scopes: string[];
  refreshToken: string;
  connectedAt: Date;
  updatedAt: Date;
}

/** What callers may see of a grant. */
export interface Grant { uid: string; googleEmail: string; features: GoogleFeature[] }

// ---------- encryption ----------

function key(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_KEY;
  const k = raw ? Buffer.from(raw, "base64") : null;
  if (!k || k.length !== 32) throw new IntegrationError("google", 503, "GOOGLE_TOKEN_KEY must be 32 bytes, base64");
  return k;
}

/** AES-256-GCM with a 32-byte key: "v1:iv:tag:data", all base64. Meta's Page tokens use it too, with their own key. */
export function sealWith(k: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function unsealWith(k: Buffer, sealed: string): string {
  const [v, iv, tag, data] = sealed.split(":");
  if (v !== "v1") throw new Error("Unknown token format");
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

export const seal = (plain: string) => sealWith(key(), plain);
export const unseal = (sealed: string) => unsealWith(key(), sealed);

// ---------- the store ----------

const view = (g: GrantDoc): Grant => ({ uid: g.uid, googleEmail: g.googleEmail, features: featuresOf(g.scopes) });

/** Save what the code exchange returned. Google sends every scope granted so far; a missing refresh token keeps the old one. */
export async function saveGrant(uid: string, userEmail: string, googleEmail: string, t: TokenResponse): Promise<Grant> {
  const prev = (await ref(uid).get()).data() as GrantDoc | undefined;
  const refresh = t.refresh_token ? seal(t.refresh_token) : prev?.refreshToken;
  if (!refresh) throw new IntegrationError("google", 400, "Google didn't send a refresh token. Remove Roadie at myaccount.google.com/connections and connect again.");
  const now = new Date();
  const doc: GrantDoc = {
    uid, emails: [...new Set([userEmail.toLowerCase(), googleEmail.toLowerCase()])], googleEmail: googleEmail.toLowerCase(),
    scopes: t.scope.split(" ").filter(Boolean), refreshToken: refresh, connectedAt: prev?.connectedAt ?? now, updatedAt: now,
  };
  await ref(uid).set(doc);
  cache.set(uid, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
  return view(doc);
}

export async function getGrant(uid: string): Promise<Grant | null> {
  const d = (await ref(uid).get()).data() as GrantDoc | undefined;
  return d ? view(d) : null;
}

async function grantDocForEmail(email: string): Promise<GrantDoc | null> {
  const snap = await firestore().collection(COLLECTION).where("emails", "array-contains", email.toLowerCase()).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as GrantDoc);
}

/** Delete the grant and return its refresh token (for revoking at Google), or null when there was none. */
export async function removeGrant(uid: string): Promise<string | null> {
  const d = (await ref(uid).get()).data() as GrantDoc | undefined;
  cache.delete(uid);
  if (!d) return null;
  await ref(uid).delete();
  try { return unseal(d.refreshToken); } catch { return null; }
}

// ---------- access tokens ----------

const cache = new Map<string, { token: string; exp: number }>();
const NAMES: Record<GoogleFeature, string> = { gmail: "Gmail", calendar: "Google Calendar", drive: "Google Drive" };
const SETTINGS = "Settings > Google";

async function tokenOf(g: GrantDoc, feature: GoogleFeature, force: boolean): Promise<string> {
  if (!featuresOf(g.scopes).includes(feature)) {
    throw new IntegrationError(feature, 401, `${g.googleEmail} hasn't connected ${NAMES[feature]}. Connect it on ${SETTINGS}.`);
  }
  const hit = cache.get(g.uid);
  if (hit && !force && hit.exp - 60_000 > Date.now()) return hit.token;
  try {
    const t = await refreshAccess(unseal(g.refreshToken));
    cache.set(g.uid, { token: t.access_token, exp: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  } catch (e) {
    if (e instanceof GoogleAuthError && e.code === "invalid_grant") {
      throw new IntegrationError(feature, 401, `${g.googleEmail}'s Google connection expired or was removed. Connect it again on ${SETTINGS}.`);
    }
    throw e;
  }
}

/** A fresh access token for this person's grant (by uid). `force` skips the cache (after a 401). */
export async function accessTokenFor(uid: string, feature: GoogleFeature, force = false): Promise<string> {
  const g = (await ref(uid).get()).data() as GrantDoc | undefined;
  if (!g) throw new IntegrationError(feature, 401, `Google isn't connected for this account. Connect it on ${SETTINGS}.`);
  return tokenOf(g, feature, force);
}

/** Same, found by the sender's address (their Roadie sign-in or their Google address). */
export async function accessTokenForEmail(email: string, feature: GoogleFeature, force = false): Promise<string> {
  const g = await grantDocForEmail(email);
  if (!g) throw new IntegrationError(feature, 401, `${email} hasn't connected Google. Connect it on ${SETTINGS}.`);
  return tokenOf(g, feature, force);
}
