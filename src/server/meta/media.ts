/**
 * The signed media URL Meta fetches a post's photo from: /api/posts/media/{postId}?exp=…&sig=…, an HMAC (META_APP_SECRET) over
 * the post's artist, its id and the expiry, good for an hour. The route streams the Drive file as the band account, so no
 * public copy is ever made in Drive.
 */
import { appUrl } from "@/lib/app-url";
import { hmac, sameMac } from "./graph";

export const MEDIA_TTL_MS = 60 * 60_000;
const body = (artistId: string, postId: string, exp: number) => `media.${artistId}.${postId}.${exp}`;

export function signMediaUrl(artistId: string, postId: string, now = Date.now()): string {
  const exp = now + MEDIA_TTL_MS;
  return `${appUrl()}/api/posts/media/${encodeURIComponent(postId)}?${new URLSearchParams({ exp: String(exp), sig: hmac(body(artistId, postId, exp)) })}`;
}

/** The link is for this post of this artist and hasn't expired. */
export function mediaSigOk(artistId: string, postId: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  const e = Number(exp);
  if (!exp || !sig || !Number.isFinite(e) || e <= now) return false;
  return sameMac(hmac(body(artistId, postId, e)), sig);
}
