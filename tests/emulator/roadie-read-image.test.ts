import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/server/db";
import { firestore } from "@/server/admin";
import { newRunId, type Ctx } from "@/server/ctx";
import { handleReadImage } from "@/server/assistant/readImage";
import { MAX_IMAGE_BYTES } from "@/schema/assistant";
import { pngWithText } from "../fixtures/png-text";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";

// Fake model mode: a PNG's `ocr` text chunk is what the image "says" (src/server/assistant/readImage.ts).
let admin: { uid: string; token: string };
beforeEach(async () => {
  await resetEmulators();
  admin = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  const sys: Ctx = { uid: admin.uid, artistId: TEST_ARTIST, role: "admin", via: "app", runId: newRunId() };
  await db.create(sys, "artists", { timeZone: "America/Denver", slug: "nora-quill-band", name: "Nora Quill Band", driveFolderId: "", links: {}, configurations: [] }, { id: TEST_ARTIST });
});

const form = (blob: Blob | null) => {
  const f = new FormData();
  if (blob) f.append("image", blob, "image.png");
  return f;
};
const png = (text: string) => new Blob([new Uint8Array(pngWithText(text))], { type: "image/png" });
const bearer = () => `Bearer ${admin.token}`;
const errCode = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

test("read-image: returns the image's text and counts one image read; nothing about the image is kept", async () => {
  const before = (await firestore().listCollections()).map((c) => c.id).sort();
  const res = await handleReadImage(bearer(), form(png("Fri Dec 5\nThe Grand, 8pm\n$15")), TEST_ARTIST);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: "Fri Dec 5\nThe Grand, 8pm\n$15" });
  const usage = (await firestore().collection("usage").where("artistId", "==", TEST_ARTIST).get()).docs;
  assert.equal(usage[0]?.get("imageReads"), 1);
  const after = (await firestore().listCollections()).map((c) => c.id).sort();
  assert.deepEqual(after.filter((c) => !before.includes(c)), ["usage"], "only the counter is written");
});

test("read-image: an image with no words is empty text", async () => {
  const res = await handleReadImage(bearer(), form(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], { type: "image/jpeg" })), TEST_ARTIST);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: "" });
});

test("read-image: no image, an empty one or a non-image is 400; one over the limit is 413", async () => {
  assert.equal((await handleReadImage(bearer(), form(null), TEST_ARTIST)).status, 400);
  const empty = await handleReadImage(bearer(), form(new Blob([], { type: "image/png" })), TEST_ARTIST);
  assert.equal(empty.status, 400);
  assert.equal(await errCode(empty), "invalid_input");
  const pdf = await handleReadImage(bearer(), form(new Blob(["%PDF-1.7"], { type: "application/pdf" })), TEST_ARTIST);
  assert.equal(pdf.status, 400);
  const big = await handleReadImage(bearer(), form(new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: "image/png" })), TEST_ARTIST);
  assert.equal(big.status, 413);
  assert.equal(await errCode(big), "too_large");
});

test("read-image: admins only, and a sign-in is needed", async () => {
  const member = await makeUser("hugo@example.com", "member", { name: "Hugo" });
  assert.equal((await handleReadImage(`Bearer ${member.token}`, form(png("hi")), TEST_ARTIST)).status, 403);
  assert.equal((await handleReadImage(null, form(png("hi")), TEST_ARTIST)).status, 401);
});
