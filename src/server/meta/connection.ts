/**
 * The band's Instagram & Facebook connection at metaConnections/{artistId}: the Page, its linked Instagram, the Page token
 * (AES-256-GCM encrypted with META_TOKEN_KEY) and who connected it. One per band, not per person: the band's account posts,
 * whoever presses the button. Server-only like googleGrants: firestore.rules has no rule for it, so no client reads it, and
 * nothing here returns the token except pageToken() to the code that calls Graph. Written with firebase-admin directly: a
 * secret, not band data, so no history and no undo.
 *
 * While someone picks one of several Pages, `pending` holds the choices (their tokens sealed too) for 15 minutes.
 */
import { firestore } from "../admin";
import { AppError } from "../errors";
import { sealWith, unsealWith } from "../google/grants";

const ref = (artistId: string) => firestore().doc(`metaConnections/${artistId}`);

function key(): Buffer {
  const raw = process.env.META_TOKEN_KEY;
  const k = raw ? Buffer.from(raw, "base64") : null;
  if (!k || k.length !== 32) throw new AppError("meta_not_configured", "META_TOKEN_KEY must be 32 bytes, base64", 503);
  return k;
}
export const sealMeta = (plain: string) => sealWith(key(), plain);
export const unsealMeta = (sealed: string) => unsealWith(key(), sealed);

export interface PageChoice { pageId: string; pageName: string; igId: string; igUsername: string }
interface PendingDoc { uid: string; exp: number; pages: (PageChoice & { token: string })[] }
interface ConnectionDoc {
  artistId: string;
  page?: { id: string; name: string };
  instagram?: { id: string; username: string };
  pageToken?: string;
  connectedBy?: { uid: string; name: string };
  connectedAt?: Date;
  pending?: PendingDoc | null;
}

/** What callers may see of the connection. */
export interface MetaConnection { page: { id: string; name: string }; instagram: { id: string; username: string }; connectedBy: { uid: string; name: string }; connectedAt: string }

const raw = async (artistId: string) => (await ref(artistId).get()).data() as ConnectionDoc | undefined;
const at = (v: unknown) => (v instanceof Date ? v : (v as { toDate(): Date }).toDate()).toISOString();

export async function getConnection(artistId: string): Promise<MetaConnection | null> {
  const d = await raw(artistId);
  if (!d?.pageToken || !d.page || !d.instagram || !d.connectedBy) return null;
  return { page: d.page, instagram: d.instagram, connectedBy: d.connectedBy, connectedAt: at(d.connectedAt) };
}

export async function saveConnection(artistId: string, c: PageChoice & { token: string }, by: { uid: string; name: string }, now = new Date()) {
  const doc: ConnectionDoc = {
    artistId, page: { id: c.pageId, name: c.pageName }, instagram: { id: c.igId, username: c.igUsername },
    pageToken: sealMeta(c.token), connectedBy: by, connectedAt: now, pending: null,
  };
  await ref(artistId).set(doc);
}

/** The Page token and the Instagram user, for Graph calls. Never returned to a client. */
export async function pageToken(artistId: string): Promise<{ token: string; igId: string; username: string }> {
  const d = await raw(artistId);
  if (!d?.pageToken || !d.instagram) throw new AppError("meta_not_connected", "Instagram isn't connected. Connect it in Settings › Integrations.", 400);
  return { token: unsealMeta(d.pageToken), igId: d.instagram.id, username: d.instagram.username };
}

export async function removeConnection(artistId: string): Promise<void> {
  await ref(artistId).delete();
}

/** Remember several Pages for this admin to pick from (tokens sealed). Keeps any working connection as it is. */
export async function savePending(artistId: string, uid: string, pages: (PageChoice & { token: string })[], now = Date.now()) {
  const pending: PendingDoc = { uid, exp: now + 15 * 60_000, pages: pages.map((p) => ({ ...p, token: sealMeta(p.token) })) };
  await ref(artistId).set({ artistId, pending }, { merge: true });
}

/** The Pages waiting for this admin's pick, without their tokens; none when expired or someone else's. */
export async function pendingFor(artistId: string, uid: string, now = Date.now()): Promise<PageChoice[] | null> {
  const p = (await raw(artistId))?.pending;
  if (!p || p.uid !== uid || p.exp <= now) return null;
  return p.pages.map(({ token: _t, ...c }) => c);
}

/** The chosen Page with its token, taken out of `pending`. */
export async function takePending(artistId: string, uid: string, pageId: string, now = Date.now()): Promise<PageChoice & { token: string }> {
  const p = (await raw(artistId))?.pending;
  const c = p && p.uid === uid && p.exp > now ? p.pages.find((x) => x.pageId === pageId) : undefined;
  if (!c) throw new AppError("invalid_state", "That choice has expired. Press Connect with Facebook again.", 400);
  return { ...c, token: unsealMeta(c.token) };
}

export async function clearPending(artistId: string) {
  if (await raw(artistId)) await ref(artistId).set({ pending: null }, { merge: true });
}
