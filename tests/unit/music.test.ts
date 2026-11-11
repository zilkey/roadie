// Music helpers: file kinds and keys, lengths, setlist totals and transitions, tempo strip, player choice, file groups (no emulator).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bpmStrip, guessKey, guessKind, fileGroup, lastRehearsed, move, parseLen, fmtLen, playerFor, playsInline, fmtTransition, setlistSlack, setlistTotal, transitionCount, transitionOf } from "@/lib/music";

test("pure helpers: kinds, keys, lengths, player choice, last rehearsed", () => {
  assert.equal(guessKind("Glass Coast chart F#m.docx"), "chart");
  assert.equal(guessKind("Glass Coast lyrics"), "lyrics");
  assert.equal(guessKind("Rehearsal 2026-10-18 full run.wav", "audio/wav"), "rehearsal");
  assert.equal(guessKind("Glass Coast demo v3.m4a", "audio/mp4"), "demo");
  assert.equal(guessKind("Glass Coast live Roots.mp4", "video/mp4"), "recording");
  assert.equal(guessKey("Glass Coast chart F#m.docx"), "F#m");
  assert.equal(guessKey("Weathervane chart d.docx"), "D");
  assert.equal(guessKey("Weathervane demo.m4a"), undefined);
  assert.equal(parseLen("3:52"), 232);
  assert.equal(parseLen("232"), 232);
  assert.equal(parseLen("abc"), undefined);
  assert.equal(fmtLen(232), "3:52");
  assert.deepEqual(move([1, 2, 3, 4], 0, 2), [2, 3, 1, 4]);
  assert.deepEqual(move([1, 2], 0, 5), [1, 2]);
  assert.equal(setlistTotal([{ lengthSec: 60 }, {}, { lengthSec: 30 }]), 90);
  // 5 songs, a 5m break, 5 songs at 30s transitions: 4 + 4 transitions, none next to the break.
  const ten = [...Array(5).fill({ type: "song", lengthSec: 200 }), { type: "break", lengthSec: 300 }, ...Array(5).fill({ type: "song", lengthSec: 200 })];
  assert.equal(transitionCount(ten), 8);
  assert.equal(setlistTotal(ten, 30), 10 * 200 + 300 + 8 * 30);
  assert.equal(transitionCount([{ type: "break" }, { type: "song" }, { type: "break" }]), 0);
  assert.equal(fmtTransition(15), "15s");
  assert.equal(fmtTransition(60), "1m");
  assert.equal(fmtTransition(90), "1m 30s");
  assert.equal(transitionOf({}), 30);
  assert.equal(transitionOf({ transitionSec: 60 }), 60);
  // the tempo strip: songs in order with their live BPM, a gap for a song without one, breaks kept in place
  const bpmOf = (id: string) => ({ a: 96, b: 132 } as Record<string, number | undefined>)[id];
  const strip = bpmStrip([{ type: "song", songId: "a", title: "A" }, { type: "break", title: "Break" }, { type: "song", songId: "c", title: "C" }, { type: "song", songId: "b", title: "B" }, { type: "song", title: "Typed" }], bpmOf);
  assert.deepEqual(strip.steps, [{ kind: "song", title: "A", bpm: 96 }, { kind: "break", title: "Break" }, { kind: "song", title: "C", bpm: undefined }, { kind: "song", title: "B", bpm: 132 }, { kind: "song", title: "Typed", bpm: undefined }]);
  assert.equal(strip.min, 96);
  assert.equal(strip.max, 132);
  assert.equal(strip.missing, 2);
  assert.deepEqual(bpmStrip([{ type: "break", title: "Break" }], bpmOf), { steps: [{ kind: "break", title: "Break" }], min: undefined, max: undefined, missing: 0 });
  assert.equal(setlistSlack(2400, 2700), 300);
  assert.equal(setlistSlack(3000, 2700), -300);
  assert.equal(playerFor({ url: "https://x.test/a.mp3", mimeType: "audio/mpeg" }).mode, "audio");
  assert.equal(playerFor({ url: "https://x.test/a.mp4", mimeType: "video/mp4" }).mode, "video");
  assert.deepEqual(playerFor({ url: "https://drive.google.com/file/d/abc/view?usp=sharing", mimeType: "audio/mp4" }), { mode: "embed", src: "https://drive.google.com/file/d/abc/preview" });
  assert.equal(playerFor({ url: "http://localhost:3202/files/fake-drive-demo-1", mimeType: "audio/mp4" }).mode, "link");
  assert.equal(playerFor({ url: "https://x.test/a.mp3", mimeType: "application/pdf" }).mode, "link");
  // The inline player takes any Drive audio (it streams through the app) and direct audio links; not video, not other links.
  assert.equal(playsInline({ url: "http://localhost:3202/files/fake-drive-demo-1", mimeType: "audio/mp4", driveFileId: "fake-drive-demo-1" }), true);
  assert.equal(playsInline({ url: "https://x.test/a.mp3", mimeType: "audio/mpeg" }), true);
  assert.equal(playsInline({ url: "https://x.test/listen", mimeType: "audio/mpeg" }), false);
  assert.equal(playsInline({ url: "https://x.test/a.mp4", mimeType: "video/mp4", driveFileId: "x" }), false);
  assert.deepEqual(lastRehearsed([{ date: "2026-10-04", songs: [{ songId: "a" }] }, { date: "2026-10-18", songs: [{ songId: "a" }, { songId: "b" }] }]), { a: "2026-10-18", b: "2026-10-18" });
});

test("fileGroup falls back to the file's kind when the mimeType is missing", () => {
  assert.equal(fileGroup({ kind: "demo" }), "audio");
  assert.equal(fileGroup({ kind: "stems" }), "audio");
  assert.equal(fileGroup({ kind: "chart" }), "doc");
  assert.equal(fileGroup({ kind: "lyrics" }), "doc");
  assert.equal(fileGroup({ kind: "other" }), "other");
  assert.equal(fileGroup({ mimeType: "application/pdf", kind: "demo" }), "pdf");
  assert.equal(fileGroup({ mimeType: "video/mp4", kind: "chart" }), "video");
});
