/**
 * Signed links for what has to load without a sign-in: a photo's thumbnail in an <img> (scope "thumb") and the photo Meta
 * fetches to post (scope "media"). The signature is an HMAC over "<scope>.<artistId>.<id>.<v>.<exp>":
 * - thumb: id is the Drive file id, v its modifiedTime ("0" when unknown), so an edited photo gets a new link;
 * - media: id is the post id, v the photo's index in the post.
 * exp is the start of the current hour plus 2 hours: a link stays the same for the whole hour (the browser's cache keeps
 * working) and is good for one to two hours.
 *
 * The key is the App Hosting secret SIGNED_URL_SECRET, separate from META_APP_SECRET so Photos works on a server without
 * Instagram set up. On a real project (GCLOUD_PROJECT set and not demo-*) a missing secret is a 503; dev, the emulators and
 * e2e use a fixed dev key, the same rule as MCP_SESSION_SECRET (mcp/web.ts).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";

export type SignedScope = "thumb" | "media";
const HOUR = 60 * 60_000;
const DEV_KEY = "roadie-dev-signed-url-key";

function key(): string {
  const k = process.env.SIGNED_URL_SECRET;
  if (k) return k;
  const project = process.env.GCLOUD_PROJECT;
  if (project && !project.startsWith("demo-")) throw new AppError("signed_urls_not_configured", "Signed links aren't set up on this server", 503);
  return DEV_KEY;
}

const mac = (scope: SignedScope, artistId: string, id: string, v: string, exp: number) =>
  createHmac("sha256", key()).update(`${scope}.${artistId}.${id}.${v}.${exp}`).digest("base64url");

/** When a link signed now expires: the start of this hour plus 2 hours (ms). */
export const expiryFor = (now = Date.now()) => Math.floor(now / HOUR) * HOUR + 2 * HOUR;

/** The `exp` and `sig` query values for this scope, artist, id and version. */
export function signUrl(scope: SignedScope, artistId: string, id: string, v: string, now = Date.now()): { exp: string; sig: string } {
  const exp = expiryFor(now);
  return { exp: String(exp), sig: mac(scope, artistId, id, v, exp) };
}

/** The link was signed here for this scope, artist, id and version, and hasn't expired. Throws the 503 when there's no key on a real project. */
export function signedOk(scope: SignedScope, artistId: string, id: string, v: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  const e = Number(exp);
  if (!exp || !sig || !Number.isInteger(e) || e <= now) return false;
  const want = Buffer.from(mac(scope, artistId, id, v, e)), got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The sizes the thumb route serves (the long edge, px): the grid, the editor's preview, and the HEIC source for posting. */
export const THUMB_SIZES = [400, 1080, 2048] as const;
export type ThumbSize = (typeof THUMB_SIZES)[number];

/**
 * A photo's thumbnail link, for an <img> on our pages: /api/posts/thumb/{artistId}/{fileId}?v=&s=&exp=&sig=. `v` is the file's
 * modifiedTime ("0" when unknown), so a changed photo gets a new link; `s` isn't signed.
 */
export function thumbUrl(artistId: string, fileId: string, modifiedTime: string | undefined, size: ThumbSize, now = Date.now()): string {
  const v = modifiedTime || "0";
  const q = new URLSearchParams({ v, s: String(size), ...signUrl("thumb", artistId, fileId, v, now) });
  return `/api/posts/thumb/${encodeURIComponent(artistId)}/${encodeURIComponent(fileId)}?${q}`;
}
