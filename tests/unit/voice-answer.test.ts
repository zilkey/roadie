import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceAnswer } from "@/lib/voice-answer";

test("a plain spoken yes, with fillers, punctuation and a trailing please / thanks, is yes", () => {
  for (const s of ["Yes", "yeah.", "Uh, yes please", "Hey Roadie, do it", "go ahead thanks", "That's right!", "YES!!", "Um, sure", "okay roadie"]) assert.equal(voiceAnswer(s), "yes", s);
});

test("a plain spoken no or cancel is cancel", () => {
  for (const s of ["No", "nope", "don't", "Don’t", "Never mind", "cancel, roadie", "Oh, no", "no thanks", "stop"]) assert.equal(voiceAnswer(s), "cancel", s);
});

test("anything else is unclear, so the card waits for a tap: a yes with more in it, both words, a hedge, a number, silence", () => {
  for (const s of [
    "yes but make it twenty", "yes no", "I think so", "", "   ", "yes yes", "no wait yes", "make it $20", "sure why not",
    "yes and also add a tip", "yes, cancel it", "maybe", "mm", "what", "yes?? no",
  ]) assert.equal(voiceAnswer(s), "unclear", JSON.stringify(s));
});
