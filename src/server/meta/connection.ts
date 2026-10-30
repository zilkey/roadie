/**
 * The band's Instagram connection at metaConnections/{artistId}: the Instagram account, the token (AES-256-GCM encrypted
 * with META_TOKEN_KEY), its kind (graph.ts, TokenKind), when it expires and was last renewed, and who connected it. One per
 * band, not per person: the band's account posts, whoever presses the button. Server-only like googleGrants: firestore.rules
 * has no rule for it, so no client reads it, and nothing here returns the token except freshToken() to the code that calls
 * Graph. Written with firebase-admin directly: a secret, not band data, so no history and no undo.
 *
 * An Instagram User token lasts 60 days and is renewed (freshToken): once it's a week old, checked before a publish and
 * whenever the card or Posts opens. Instagram refuses to renew one under 24 hours old. A renewal that fails is kept as
 * `renewError`, and the card and Posts read "Sign in again" with Instagram's reason.
 */
import { firestore } from "../admin";
import { AppError } from "../errors";
import { sealWith, unsealWith } from "../google/grants";
import { graph, GraphError, type Tok, type TokenKind } from "./graph";

const ref = (artistId: string) => firestore().doc(`metaConnections/${artistId}`);

function key(): Buffer {
  const raw = process.env.META_TOKEN_KEY;
  const k = raw ? Buffer.from(raw, "base64") : null;
  if (!k || k.length !== 32) throw new AppError("meta_not_configured", "META_TOKEN_KEY must be 32 bytes, base64", 503);
  return k;
}
export const sealMeta = (plain: string) => sealWith(key(), plain);
export const unsealMeta = (sealed: string) => unsealWith(key(), sealed);

/** Renew an Instagram User token once it's this old. Instagram won't before a day. */
export const RENEW_AFTER_MS = 7 * 24 * 60 * 60_000;

/** What finishConnect found. */
export interface NewConnection { kind: TokenKind; token: string; instagram: { id: string; username: string }; businessId: string | null; expiresAt: Date | null }
interface ConnectionDoc {
  artistId: string;
  kind: TokenKind;
  instagram: { id: string; username: string };
  /** The band's business portfolio (system-user token only). */
  businessId: string | null;
  configId: string | null;
  token: string;
  /** Null: doesn't expire. */
  expiresAt: Date | null;
  renewedAt: Date;
  renewError: string | null;
  connectedBy: { uid: string; name: string };
  connectedAt: Date;
}

/** What callers may see of the connection. renews: Roadie renews the token; else it lasts until expiresAt (null: never). */
export interface MetaConnection {
  kind: TokenKind;
  instagram: { id: string; username: string };
  renews: boolean;
  expiresAt: string | null;
  connectedBy: { uid: string; name: string };
  connectedAt: string;
}

type Stamp = Date | { toDate(): Date };
const date = (v: Stamp) => (v instanceof Date ? v : v.toDate());
async function raw(artistId: string): Promise<ConnectionDoc | null> {
  const d = (await ref(artistId).get()).data();
  if (!d?.token || !d.instagram || !d.connectedBy) return null;
  return { ...d, expiresAt: d.expiresAt ? date(d.expiresAt) : null, renewedAt: date(d.renewedAt), connectedAt: date(d.connectedAt) } as ConnectionDoc;
}

export async function getConnection(artistId: string): Promise<MetaConnection | null> {
  const d = await raw(artistId);
  if (!d) return null;
  return {
    kind: d.kind, instagram: d.instagram, renews: d.kind === "instagram", expiresAt: d.expiresAt?.toISOString() ?? null,
    connectedBy: d.connectedBy, connectedAt: d.connectedAt.toISOString(),
  };
}

export async function saveConnection(artistId: string, c: NewConnection, by: { uid: string; name: string }, now = new Date()) {
  const doc: ConnectionDoc = {
    artistId, kind: c.kind, instagram: c.instagram, businessId: c.businessId, configId: process.env.META_CONFIG_ID ?? null,
    token: sealMeta(c.token), expiresAt: c.expiresAt, renewedAt: now, renewError: null, connectedBy: by, connectedAt: now,
  };
  await ref(artistId).set(doc);
}

/** Why the stored token can't be used any more, or null while it can. */
const deadReason = (d: ConnectionDoc, now: Date) => d.renewError ?? (d.expiresAt && d.expiresAt <= now ? "The sign-in expired." : null);

/**
 * The token and the Instagram account, for Graph calls, renewed first when it's due. Never returned to a client.
 * Throws meta_sign_in_again when it has expired or a renewal failed.
 */
export async function freshToken(artistId: string, now = new Date()): Promise<Tok & { igId: string; username: string }> {
  let d = await raw(artistId);
  if (!d) throw new AppError("meta_not_connected", "Instagram isn't connected. Connect it in Settings › Integrations.", 400);
  if (!deadReason(d, now) && d.kind === "instagram" && now.getTime() - d.renewedAt.getTime() >= RENEW_AFTER_MS) d = await renew(artistId, d, now);
  const dead = deadReason(d, now);
  if (dead) throw new AppError("meta_sign_in_again", `Instagram needs signing in again: ${dead} Connect again in Settings › Integrations.`, 400, undefined, { reason: dead });
  return { token: unsealMeta(d.token), kind: d.kind, igId: d.instagram.id, username: d.instagram.username };
}

async function renew(artistId: string, d: ConnectionDoc, now: Date): Promise<ConnectionDoc> {
  try {
    const r = await graph.refresh(unsealMeta(d.token));
    const next = { token: sealMeta(r.access_token), expiresAt: new Date(now.getTime() + r.expires_in * 1000), renewedAt: now, renewError: null };
    await ref(artistId).set(next, { merge: true });
    return { ...d, ...next };
  } catch (e) {
    if (!(e instanceof GraphError)) throw e;
    await ref(artistId).set({ renewError: e.message }, { merge: true });
    return { ...d, renewError: e.message };
  }
}

export async function removeConnection(artistId: string): Promise<void> {
  await ref(artistId).delete();
}
