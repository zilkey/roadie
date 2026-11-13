import { test } from "node:test";
import assert from "node:assert/strict";
import { hitsOn, playableBpm, secondsPerBeat } from "@/lib/metronome";

test("the default groove: hi-hat on all four beats, kick on the one", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(hitsOn), [["kick", "hat"], ["hat"], ["hat"], ["hat"], ["kick", "hat"], ["hat"]]);
});

test("playableBpm rounds a song's BPM and refuses missing or silly ones", () => {
  assert.equal(playableBpm(96), 96);
  assert.equal(playableBpm(120.4), 120);
  for (const v of [null, undefined, NaN, 0, 5, 1000]) assert.equal(playableBpm(v), null, String(v));
});

test("a beat at 120 bpm is half a second", () => {
  assert.equal(secondsPerBeat(120), 0.5);
});
