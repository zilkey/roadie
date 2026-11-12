/**
 * A post's photo as it goes to Instagram (the media route, /api/posts/media/{postId}/{index}): read from Drive, turned upright,
 * cropped to the post's shape around the photo's focus, and sized to 1080 wide as an sRGB JPEG.
 * - JPEG, PNG and WebP come from the original (download). HEIC and HEIF come from Drive's own preview at 2048 (thumbnail),
 *   because Drive already decodes HEIC and sharp's prebuilt build can't. Drive's previews are already upright.
 * - The crop is CSS `object-fit: cover; object-position: fx·100% fy·100%` on the upright photo, so the editor's preview shows
 *   the crop that gets posted.
 */
import sharp from "sharp";
import type { DriveService } from "./integrations";
import { IntegrationError } from "./integrations";
import type { PostMedia } from "@/schema/posts";

/** The size of Drive's preview a HEIC is posted from (the long edge). */
export const HEIC_PREVIEW = 2048;
const OUT_WIDTH = 1080;

/** A HEIC Drive hasn't made a preview of yet. */
export class NoPreviewError extends Error {}
export const noPreview = (name?: string) => `Drive hasn't made a preview of ${(name ?? "that photo").replace(/\.[^.]+$/, "")} yet; try again in a minute`;

export const fromPreview = (mimeType: string) => mimeType === "image/heic" || mimeType === "image/heif";

/** The crop box for target aspect a (width/height) on an upright W×H photo, centred at focus (fx, fy). */
export function cropBox(W: number, H: number, a: number, fx = 0.5, fy = 0.5): { left: number; top: number; width: number; height: number } {
  if (W / H > a) {
    const cw = Math.round(H * a);
    return { left: Math.round(fx * (W - cw)), top: 0, width: cw, height: H };
  }
  const ch = Math.round(W / a);
  return { left: 0, top: Math.round(fy * (H - ch)), width: W, height: ch };
}

async function source(drive: DriveService, m: PostMedia): Promise<Buffer> {
  if (fromPreview(m.mimeType)) {
    try {
      return Buffer.from(await (await drive.thumbnail(m.driveFileId, HEIC_PREVIEW)).arrayBuffer());
    } catch (e) {
      if (e instanceof IntegrationError && e.status === 404) throw new NoPreviewError(noPreview(m.name));
      throw e;
    }
  }
  const res = await drive.download(m.driveFileId);
  if (!res.ok) throw new IntegrationError("drive", res.status, res.statusText || "Drive couldn't send the photo");
  return Buffer.from(await res.arrayBuffer());
}

/** The JPEG Instagram gets for this photo: upright, cropped to `aspect` around its focus, 1080 wide (upscaled if need be). */
export async function renderPostPhoto(drive: DriveService, m: PostMedia, aspect: "4:5" | "1:1"): Promise<Buffer> {
  const a = aspect === "1:1" ? 1 : 4 / 5;
  const { data, info } = await sharp(await source(drive, m)).rotate().toBuffer({ resolveWithObject: true });
  const box = cropBox(info.width, info.height, a, m.focus?.x ?? 0.5, m.focus?.y ?? 0.5);
  return sharp(data).extract(box).resize(OUT_WIDTH, Math.round(OUT_WIDTH / a), { fit: "fill" }).toColourspace("srgb").jpeg({ quality: 90 }).toBuffer();
}
