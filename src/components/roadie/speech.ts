// Browser speech helpers: one shared AudioContext plus text-to-speech.
// No React. Written for installed iOS Safari PWAs and Android Chrome.

let ctx: AudioContext | null = null;

/** One shared AudioContext, created lazily. iOS Safari older than 14.5 only has the webkit prefix. */
export function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx && ctx.state !== "closed") return ctx;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

export function speechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/**
 * Call SYNCHRONOUSLY inside a tap handler. iOS only lets an AudioContext leave
 * "suspended" and only lets speechSynthesis speak when first used inside a user
 * gesture; after that, later speak() calls (after awaits, off the gesture) work.
 */
export function unlockAudio(): void {
  try {
    const c = audioContext();
    if (c && c.state !== "running") void c.resume().catch(() => {});
  } catch {
    // ignore
  }
  if (!speechAvailable()) return;
  try {
    // A silent utterance primes the speech engine. Volume 0 on a single space;
    // an empty string is skipped by some engines and would not unlock anything.
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    u.lang = "en-US";
    window.speechSynthesis.speak(u);
  } catch {
    // ignore
  }
}

// Bumped by stopSpeaking so in-flight speak() calls know to give up.
let epoch = 0;

export function stopSpeaking(): void {
  epoch++;
  if (!speechAvailable()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}

/** Strip markdown and links so the voice does not read symbols aloud. */
function toSpeakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\b(?:https?:\/\/|www\.)[^\s)]+/gi, "the link")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__|\*|`|~~)/g, "")
    .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,;:!?])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentence-sized chunks. Chrome silently stops utterances after ~15 s, so keep them short. */
function toChunks(text: string): string[] {
  const sentences = text.match(/[^.!?;:]+(?:[.!?]+["')\]]*|$)\s*/g) ?? [text];
  const out: string[] = [];
  for (const raw of sentences) {
    let s = raw.trim();
    if (!s) continue;
    while (s.length > 220) {
      let cut = s.lastIndexOf(", ", 220);
      if (cut < 60) cut = s.lastIndexOf(" ", 220);
      if (cut < 1) cut = 220;
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if (s) out.push(s);
  }
  return out;
}

const GOOD_VOICE = /enhanced|premium|siri|samantha|google us english|natural/i;
let voicePromise: Promise<SpeechSynthesisVoice | null> | null = null;

function chooseVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  const pool = english.length ? english : voices;
  const us = (v: SpeechSynthesisVoice) => /^en[-_]us$/i.test(v.lang);
  return (
    pool.find((v) => v.localService && GOOD_VOICE.test(v.name) && us(v)) ??
    pool.find((v) => v.localService && GOOD_VOICE.test(v.name)) ??
    pool.find((v) => GOOD_VOICE.test(v.name) && us(v)) ??
    pool.find((v) => us(v) && v.default) ??
    pool.find((v) => us(v)) ??
    pool.find((v) => v.default) ??
    pool[0] ??
    null
  );
}

/** Voices load asynchronously (always on iOS, often on Chrome): wait for voiceschanged, at most ~1 s. */
function loadVoice(): Promise<SpeechSynthesisVoice | null> {
  if (voicePromise) return voicePromise;
  const synth = window.speechSynthesis;
  const p = new Promise<SpeechSynthesisVoice | null>((resolve) => {
    const have = synth.getVoices();
    if (have.length) return resolve(chooseVoice(have));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      synth.removeEventListener?.("voiceschanged", finish);
      resolve(chooseVoice(synth.getVoices()));
    };
    const timer = setTimeout(finish, 1000);
    synth.addEventListener?.("voiceschanged", finish);
  });
  voicePromise = p;
  // Don't cache an empty result forever: a later call may find voices.
  void p.then((v) => {
    if (!v && voicePromise === p) voicePromise = null;
  });
  return p;
}

function speakChunk(chunk: string, voice: SpeechSynthesisVoice | null, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    try {
      const u = new SpeechSynthesisUtterance(chunk);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = "en-US";
      }
      u.rate = 1.05;
      u.onend = finish;
      u.onerror = finish;
      signal?.addEventListener("abort", finish);
      // Some engines never fire onend (iOS after interruptions); don't hang the caller.
      watchdog = setTimeout(finish, 4000 + chunk.length * 120);
      window.speechSynthesis.speak(u);
    } catch {
      finish();
    }
  });
}

/** Speak text aloud, sentence by sentence. Resolves when done, on error or abort. Never rejects. */
export async function speak(text: string, opts?: { signal?: AbortSignal }): Promise<void> {
  try {
    const signal = opts?.signal;
    if (!speechAvailable() || signal?.aborted) return;
    const clean = toSpeakable(text);
    if (!clean) return;
    const myEpoch = epoch;
    const cancelled = () => !!signal?.aborted || epoch !== myEpoch;
    const onAbort = () => {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    };
    signal?.addEventListener("abort", onAbort);
    try {
      const voice = await loadVoice();
      for (const chunk of toChunks(clean)) {
        if (cancelled()) break;
        await speakChunk(chunk, voice, signal);
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  } catch {
    // never reject
  }
}
