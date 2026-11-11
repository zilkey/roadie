import type { VoiceAnswer } from "@/schema/assistant";

const YES = new Set([
  "yes", "yeah", "yep", "yup", "yes please", "sure", "ok", "okay", "do it", "go ahead", "go for it", "please do",
  "sounds good", "correct", "thats right", "confirm", "affirmative", "absolutely", "definitely",
]);
const CANCEL = new Set([
  "no", "nope", "nah", "cancel", "dont", "do not", "stop", "never mind", "nevermind", "no thanks", "not now", "hold on", "wait", "leave it", "forget it",
]);

const LEADING = /^(?:uh|um|oh|hey|roadie|ok so)\s+/;
const TRAILING = /\s+(?:please|thanks|thank you|roadie)$/;

/**
 * A spoken reply to a confirm card ("Want me to add $10 income from The Trident Bookstore?") as yes, cancel or unclear.
 * Deliberately strict, because a yes runs a write: the card's input is never taken from speech, and only an exact yes
 * runs it. After trimming fillers ("uh", "hey roadie") and a trailing "please" / "thanks", the WHOLE utterance must be
 * one phrase from a fixed list. "yes but make it 20", "yes no", "I think so", a mishear or silence are all "unclear",
 * and the card waits for a tap. Apostrophes are dropped on both sides so "don't" and "dont" match.
 */
export function voiceAnswer(transcript: string): VoiceAnswer {
  let s = transcript.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  for (let prev = ""; prev !== s;) { prev = s; s = s.replace(LEADING, "").replace(TRAILING, ""); }
  if (YES.has(s)) return "yes";
  if (CANCEL.has(s)) return "cancel";
  return "unclear";
}
