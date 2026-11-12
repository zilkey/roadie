/**
 * The signed media URL Meta fetches a post's photo from: /api/posts/media/{postId}?exp=…&sig=…, signed with
 * src/server/signedUrl.ts (scope "media", the photo's index as the version; good for one to two hours). The route streams the
 * Drive file as the band account, so no public copy is ever made in Drive.
 */
import { appUrl } from "@/lib/app-url";
import { signUrl, signedOk } from "../signedUrl";

export function signMediaUrl(artistId: string, postId: string, now = Date.now()): string {
  return `${appUrl()}/api/posts/media/${encodeURIComponent(postId)}?${new URLSearchParams(signUrl("media", artistId, postId, "0", now))}`;
}

/** The link is for this post of this artist and hasn't expired. */
export function mediaSigOk(artistId: string, postId: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  return signedOk("media", artistId, postId, "0", exp, sig, now);
}
