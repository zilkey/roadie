import { test } from "node:test";
import assert from "node:assert/strict";
import { clampPx, DEFAULT_PX, dragTo, fromSaved, keyTo, maxPx, MIN_PX, STEP_PX } from "@/lib/roadie-width";

test("maxPx is half the window, never under the minimum", () => {
  assert.equal(maxPx(1280), 640);
  assert.equal(maxPx(1001), 500);
  assert.equal(maxPx(400), MIN_PX);
});

test("clampPx keeps a width between 280 and half the window", () => {
  assert.equal(clampPx(400, 1280), 400);
  assert.equal(clampPx(100, 1280), MIN_PX);
  assert.equal(clampPx(900, 1280), 640);
  assert.equal(clampPx(600, 1000), 500); // the window shrank under a saved width
  assert.equal(clampPx(333.6, 1280), 334);
});

test("fromSaved maps old and missing values to sizes", () => {
  assert.equal(fromSaved("narrow"), "narrow");
  assert.equal(fromSaved("full"), DEFAULT_PX);
  assert.equal(fromSaved(undefined), DEFAULT_PX);
  assert.equal(fromSaved(null), DEFAULT_PX);
  assert.equal(fromSaved(480), 480);
  assert.equal(fromSaved("480"), 480); // the localStorage mirror
  for (const junk of ["", "wide", "12", 12, NaN, -400, "4.5e2"]) assert.equal(fromSaved(junk), DEFAULT_PX, String(junk));
});

test("dragTo snaps below the minimum to the rail and clamps the rest", () => {
  assert.equal(dragTo(279, 1280), "narrow");
  assert.equal(dragTo(0, 1280), "narrow");
  assert.equal(dragTo(-50, 1280), "narrow");
  assert.equal(dragTo(280, 1280), 280);
  assert.equal(dragTo(500, 1280), 500);
  assert.equal(dragTo(1000, 1280), 640);
});

test("keyTo: left widens, right narrows, Home/End go to the ends, clamped; other keys do nothing", () => {
  assert.equal(keyTo("ArrowLeft", 360, 1280), 360 + STEP_PX);
  assert.equal(keyTo("ArrowRight", 360, 1280), 360 - STEP_PX);
  assert.equal(keyTo("ArrowRight", 285, 1280), MIN_PX); // keys never snap to the rail
  assert.equal(keyTo("ArrowLeft", 635, 1280), 640);
  assert.equal(keyTo("Home", 500, 1280), MIN_PX);
  assert.equal(keyTo("End", 300, 1280), 640);
  assert.equal(keyTo("Enter", 360, 1280), null);
  assert.equal(keyTo("ArrowUp", 360, 1280), null);
});
