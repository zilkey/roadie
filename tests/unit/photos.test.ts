import { test } from "node:test";
import assert from "node:assert/strict";
import { PHOTO_TYPES, photoType, hashtagCount } from "@/lib/photos";

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
