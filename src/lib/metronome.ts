/**
 * The song metronome's groove, kept free of the browser so it can be tested: which drums hit on each beat of a bar,
 * and how long a beat lasts. The default is a hi-hat on all four beats with a kick on the one.
 */
export type Drum = "kick" | "hat";

export const BEATS_PER_BAR = 4;

/** The drums on a beat (0-based within the bar). */
export function hitsOn(beat: number): Drum[] {
  return beat % BEATS_PER_BAR === 0 ? ["kick", "hat"] : ["hat"];
}

/** A usable tempo from a song's BPM, or null when it has none (the metronome then doesn't show). */
export function playableBpm(bpm: number | null | undefined): number | null {
  if (bpm == null || !Number.isFinite(bpm)) return null;
  const n = Math.round(bpm);
  return n >= 20 && n <= 400 ? n : null;
}

export const secondsPerBeat = (bpm: number) => 60 / bpm;
