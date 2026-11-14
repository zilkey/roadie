import { test } from "node:test";
import assert from "node:assert/strict";
import { PHOTO_TYPES, VIDEO_TYPES, photoType, mediaType, hashtagCount, videoProblem, postKind, fmtDuration } from "@/lib/photos";

test("photoType: a photo mimeType as it is; else the type of a photo extension; else null", () => {
  for (const t of PHOTO_TYPES) assert.equal(photoType("x", t), t);
  assert.equal(photoType("IMG_1.JPG", "IMAGE/JPEG"), "image/jpeg", "the mimeType's case doesn't matter");
  // Phones and Drive often send a HEIC as octet-stream, or with no type at all.
  assert.equal(photoType("IMG_2201.HEIC", "application/octet-stream"), "image/heic");
  assert.equal(photoType("IMG_2201.heif", ""), "image/heif");
  assert.equal(photoType("a.jpeg", undefined), "image/jpeg");
  assert.equal(photoType("a.jpg", null), "image/jpeg");
  assert.equal(photoType("a.png", "application/octet-stream"), "image/png");
  assert.equal(photoType("a.webp", ""), "image/webp");
  assert.equal(photoType("Set list.pdf", "application/pdf"), null);
  assert.equal(photoType("clip.mov", "video/quicktime"), null);
  assert.equal(photoType("anim.gif", "image/gif"), null, "an image type Instagram doesn't take");
  assert.equal(photoType("noext", "application/octet-stream"), null);
  assert.equal(photoType("jpg", ""), null, "a name that is only the extension isn't one");
});

test("hashtagCount: a # at the start or after whitespace, then letters, digits or _", () => {
  assert.equal(hashtagCount(""), 0);
  assert.equal(hashtagCount("#denver"), 1);
  assert.equal(hashtagCount("Thanks #Denver #live_music #2026\n#café"), 4);
  assert.equal(hashtagCount("a#b and # alone and ##x"), 0, "not after a letter, not bare, not doubled");
  assert.equal(hashtagCount("(#nope) email@x.com #yes."), 1);
  assert.equal(hashtagCount(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ")), 31);
});

test("mediaType: photos as photoType has them, plus MP4 and MOV videos by type or extension; photoType still takes photos only", () => {
  for (const t of [...PHOTO_TYPES, ...VIDEO_TYPES]) assert.equal(mediaType("x", t), t);
  assert.equal(mediaType("IMG_2201.HEIC", "application/octet-stream"), "image/heic");
  assert.equal(mediaType("clip.MOV", "application/octet-stream"), "video/quicktime", "a phone's MOV as octet-stream");
  assert.equal(mediaType("clip.mp4", ""), "video/mp4");
  assert.equal(mediaType("clip.m4v", null), "video/mp4");
  assert.equal(mediaType("clip.webm", "video/webm"), null, "a video type Instagram doesn't take");
  assert.equal(mediaType("Set list.pdf", "application/pdf"), null);
  assert.equal(photoType("clip.mp4", "video/mp4"), null);
});

test("videoProblem: a Reel is 3 seconds to 15 minutes and 300 MB; a carousel video 3 to 60 seconds and 100 MB; unknown passes", () => {
  const MB = 1024 * 1024;
  assert.equal(videoProblem({ name: "Encore.mp4" }, false), null, "Drive doesn't know yet: Instagram decides");
  assert.equal(videoProblem({ name: "Encore.mp4", durationMs: 90_000, bytes: 80 * MB }, false), null);
  assert.equal(videoProblem({ name: "Encore.mp4", durationMs: 90_000 }, true), "Encore is 1:30: a video in a carousel can be at most 60 seconds. Post it alone, as a Reel");
  assert.equal(videoProblem({ name: "Blip.mov", durationMs: 2_000 }, false), "Blip is 0:02: a reel has to be at least 3 seconds");
  assert.equal(videoProblem({ name: "Set.mp4", durationMs: 16 * 60_000 }, false), "Set is 16:00: a reel can be at most 15 minutes");
  assert.equal(videoProblem({ name: "Set.mp4", durationMs: 30_000, bytes: 150 * MB }, true), "Set is over 100 MB, the most Instagram takes for a video in a carousel");
  assert.equal(videoProblem({ name: "Set.mp4", durationMs: 30_000, bytes: 150 * MB }, false), null);
  assert.equal(fmtDuration(605_000), "10:05");
});

test("postKind: one photo, a Reel, photos, videos, or a mix", () => {
  assert.equal(postKind(1, 0), "1 photo");
  assert.equal(postKind(1, 1), "Reel");
  assert.equal(postKind(3, 0), "3 photos");
  assert.equal(postKind(2, 2), "2 videos");
  assert.equal(postKind(4, 1), "4 items: 3 photos, 1 video");
  assert.equal(postKind(3, 2), "3 items: 1 photo, 2 videos");
});
