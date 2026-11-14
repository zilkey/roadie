/**
 * The signed media URLs Meta fetches a post's photos and videos from: /api/posts/media/{postId}/{index}?exp=…&sig=…, signed
 * with src/server/signedUrl.ts (scope "media", the item's index in the post as the version; good for one to two hours). The
 * route renders a photo from Drive as the band account (cropped to the post's shape) and streams a video as it is, so no
 * public copy is ever made in Drive.
 */
import { appUrl } from "@/lib/app-url";
import { signUrl, signedOk } from "../signedUrl";

export function signMediaUrl(artistId: string, postId: string, index: number, now = Date.now()): string {
  const q = new URLSearchParams(signUrl("media", artistId, postId, String(index), now));
  return `${appUrl()}/api/posts/media/${encodeURIComponent(postId)}/${index}?${q}`;
}

/** The link is for this photo of this post of this artist and hasn't expired. */
export function mediaSigOk(artistId: string, postId: string, index: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  return signedOk("media", artistId, postId, index, exp, sig, now);
}
