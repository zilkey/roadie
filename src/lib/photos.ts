/**
 * Photos and videos for Posts: which files Posts takes, Instagram's limits on a video, and the caption's hashtag count.
 * Shared by the server (commands, the upload route) and the pages, so both say the same thing about a file.
 */

/** The photo types Posts takes from Drive or an upload. */
export const PHOTO_TYPES = ["image/jpeg", "image/heic", "image/heif", "image/png", "image/webp"] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];
/** The video types Instagram takes for Reels and carousel videos: MP4 and MOV. */
export const VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;
export type VideoType = (typeof VIDEO_TYPES)[number];
export type MediaType = PhotoType | VideoType;

/** Said when a file isn't one of PHOTO_TYPES or VIDEO_TYPES. */
export const MEDIA_ONLY = "Roadie takes JPEG, HEIC, PNG and WebP photos, and MP4 and MOV videos";

const BY_EXTENSION: Record<string, MediaType> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", heic: "image/heic", heif: "image/heif", png: "image/png", webp: "image/webp",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime",
};

/**
 * The type to treat a file as: its `mimeType` when that is a photo or video type, else the type its extension names (phones
 * and Drive often send HEIC and MOV as application/octet-stream), else null: not something Posts can use.
 */
export function mediaType(name: string, mimeType: string | null | undefined): MediaType | null {
  const m = (mimeType ?? "").toLowerCase();
  if ((PHOTO_TYPES as readonly string[]).includes(m) || (VIDEO_TYPES as readonly string[]).includes(m)) return m as MediaType;
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return (ext && BY_EXTENSION[ext]) || null;
}

/** mediaType, for photos only. */
export function photoType(name: string, mimeType: string | null | undefined): PhotoType | null {
  const t = mediaType(name, mimeType);
  return t && !isVideo(t) ? (t as PhotoType) : null;
}

export const isVideo = (mimeType: string) => mimeType.startsWith("video/");

/**
 * Instagram's limits on a video (the Graph API's Reels and carousel video specs): a Reel is 3 seconds to 15 minutes and at
 * most 300 MB; a video in a carousel is 3 to 60 seconds and at most 100 MB.
 */
export const VIDEO_LIMITS = {
  reel: { minMs: 3_000, maxMs: 15 * 60_000, maxBytes: 300 * 1024 * 1024, maxLabel: "15 minutes", sizeLabel: "300 MB" },
  carousel: { minMs: 3_000, maxMs: 60_000, maxBytes: 100 * 1024 * 1024, maxLabel: "60 seconds", sizeLabel: "100 MB" },
} as const;

/** "0:07", "1:30", "12:05". */
export const fmtDuration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Why Instagram won't take this video as a Reel (alone in its post) or in a carousel, from what Drive knows of it; null when
 * it's within the limits or Drive doesn't say (Instagram then decides).
 */
export function videoProblem(v: { name?: string; durationMs?: number; bytes?: number }, inCarousel: boolean): string | null {
  const L = inCarousel ? VIDEO_LIMITS.carousel : VIDEO_LIMITS.reel;
  const n = (v.name ?? "That video").replace(/\.[^.]+$/, ""), as = inCarousel ? "A video in a carousel" : "A Reel";
  if (v.durationMs !== undefined && v.durationMs < L.minMs) return `${n} is ${fmtDuration(v.durationMs)}: ${as.toLowerCase()} has to be at least 3 seconds`;
  if (v.durationMs !== undefined && v.durationMs > L.maxMs) {
    return `${n} is ${fmtDuration(v.durationMs)}: ${as.toLowerCase()} can be at most ${L.maxLabel}${inCarousel ? ". Post it alone, as a Reel" : ""}`;
  }
  if (v.bytes !== undefined && v.bytes > L.maxBytes) return `${n} is over ${L.sizeLabel}, the most Instagram takes for ${as.toLowerCase()}`;
  return null;
}

/** What a post is, by how many photos and videos it has: "1 photo", "Reel", "3 photos", "4 items: 3 photos, 1 video". */
export function postKind(count: number, videos: number): string {
  if (count === 1) return videos ? "Reel" : "1 photo";
  if (!videos) return `${count} photos`;
  if (videos === count) return `${count} videos`;
  const photos = count - videos;
  return `${count} items: ${photos} ${photos === 1 ? "photo" : "photos"}, ${videos} ${videos === 1 ? "video" : "videos"}`;
}

/** Instagram's caption limits. */
export const CAPTION_MAX = 2200;
export const HASHTAG_MAX = 30;

/** How many hashtags Instagram would count in a caption: a # at the start or after whitespace, then letters, digits or _. */
export function hashtagCount(caption: string): number {
  return caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;
}
