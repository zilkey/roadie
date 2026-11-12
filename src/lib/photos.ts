/**
 * Photos for Posts: which files count as a photo, and the caption's hashtag count. Shared by the server (commands, the upload
 * route) and the pages, so both say the same thing about a file.
 */

/** The photo types Posts takes from Drive or an upload. */
export const PHOTO_TYPES = ["image/jpeg", "image/heic", "image/heif", "image/png", "image/webp"] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

/** Said when a file isn't one of PHOTO_TYPES. */
export const PHOTOS_ONLY = "Roadie takes JPEG, HEIC, PNG and WebP photos";

const BY_EXTENSION: Record<string, PhotoType> = { jpg: "image/jpeg", jpeg: "image/jpeg", heic: "image/heic", heif: "image/heif", png: "image/png", webp: "image/webp" };

/**
 * The type to treat a file as: its `mimeType` when that is a photo type, else the type its extension names (phones and Drive
 * often send HEIC as application/octet-stream), else null: not a photo Posts can use.
 */
export function photoType(name: string, mimeType: string | null | undefined): PhotoType | null {
  const m = (mimeType ?? "").toLowerCase();
  if ((PHOTO_TYPES as readonly string[]).includes(m)) return m as PhotoType;
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return (ext && BY_EXTENSION[ext]) || null;
}

/** Instagram's caption limits. */
export const CAPTION_MAX = 2200;
export const HASHTAG_MAX = 30;

/** How many hashtags Instagram would count in a caption: a # at the start or after whitespace, then letters, digits or _. */
export function hashtagCount(caption: string): number {
  return caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;
}
