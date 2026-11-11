// Microphone recording with silence detection. No React.
// Written for installed iOS Safari PWAs and Android Chrome.

import { audioContext } from "./speech";

const IDLE_MS = 30_000;
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac", "audio/ogg;codecs=opus"];

export function micAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined"
  );
}

/** Safari only does audio/mp4, Chrome/Firefox do webm/ogg: take the first one this browser accepts. */
export function pickMimeType(): string {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined") return "";
  for (const t of MIME_TYPES) {
    try {
      if (window.MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      // ignore
    }
  }
  return "";
}

// Cached stream. iOS can re-prompt for the mic on every getUserMedia call (or every launch),
// so keep one stream alive for 30 s after the last recording, then stop its tracks so the
// recording indicator goes away.
let cached: MediaStream | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let users = 0;

function live(s: MediaStream | null): s is MediaStream {
  return !!s && s.getAudioTracks().some((t) => t.readyState === "live");
}

export function releaseMic(): void {
  clearTimeout(idleTimer);
  idleTimer = undefined;
  if (cached) {
    for (const t of cached.getTracks()) t.stop();
    cached = null;
  }
}

async function acquireMic(): Promise<MediaStream> {
  clearTimeout(idleTimer);
  idleTimer = undefined;
  if (live(cached)) {
    users++;
    return cached;
  }
  cached = null;
  if (!micAvailable()) throw new Error("No microphone found");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    cached = stream;
    users++;
    return stream;
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
      throw new Error("No microphone found");
    }
    throw new Error("Roadie needs the microphone: allow it in your browser settings");
  }
}

function leaveMic(): void {
  users = Math.max(0, users - 1);
  if (users === 0) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(releaseMic, IDLE_MS);
  }
}

export type RecordOptions = {
  maxMs: number;
  silenceMs: number;
  noSpeechMs: number;
  signal?: AbortSignal;
  onLevel?: (level: number) => void;
  onSpeech?: () => void;
};

export async function record(opts: RecordOptions): Promise<{ blob: Blob; mimeType: string } | null> {
  const { maxMs, silenceMs, noSpeechMs, signal, onLevel, onSpeech } = opts;
  if (signal?.aborted) return null;
  const stream = await acquireMic();
  if (signal?.aborted) {
    leaveMic();
    return null;
  }

  const wanted = pickMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = wanted ? new MediaRecorder(stream, { mimeType: wanted }) : new MediaRecorder(stream);
  } catch {
    leaveMic();
    throw new Error("No microphone found");
  }

  // Level meter. The context is resumed by unlockAudio() in the tap; resume again in case iOS suspended it.
  const ctx = audioContext();
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let buf: Float32Array<ArrayBuffer> | null = null;
  if (ctx) {
    try {
      if (ctx.state !== "running") void ctx.resume().catch(() => {});
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser); // not connected to destination: no feedback
      buf = new Float32Array(analyser.fftSize);
    } catch {
      source = null;
      analyser = null;
    }
  }

  return new Promise((resolve, reject) => {
    const chunks: Blob[] = [];
    const startedAt = performance.now();
    let speechHeard = !analyser; // no meter: can't detect, so rely on maxMs only
    let discard = false;
    let stopped = false;
    let quietSince = 0;
    let floorSum = 0;
    let floorN = 0;
    let threshold = 0.02;
    let poll: ReturnType<typeof setInterval> | undefined;
    let maxTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearInterval(poll);
      clearTimeout(maxTimer);
      signal?.removeEventListener("abort", onAbort);
      try {
        source?.disconnect();
        analyser?.disconnect();
      } catch {
        // ignore
      }
      leaveMic();
    };

    const stop = (drop: boolean) => {
      if (stopped) return;
      stopped = true;
      discard = drop;
      clearInterval(poll);
      clearTimeout(maxTimer);
      try {
        if (recorder.state !== "inactive") recorder.stop();
        else recorder.onstop?.(new Event("stop"));
      } catch {
        recorder.onstop?.(new Event("stop"));
      }
    };
    const onAbort = () => stop(true);

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => {
      cleanup();
      reject(new Error("Recording failed"));
    };
    recorder.onstop = () => {
      cleanup();
      if (discard || chunks.length === 0) return resolve(null);
      const mimeType = recorder.mimeType || wanted || chunks[0].type || "audio/mp4";
      resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType });
    };

    signal?.addEventListener("abort", onAbort);

    const tick = () => {
      const now = performance.now();
      const elapsed = now - startedAt;
      let level = 0;
      if (analyser && buf) {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        level = Math.min(1, rms * 4);
        if (elapsed < 250) {
          // Measure the room's noise floor before judging speech.
          floorSum += rms;
          floorN++;
          threshold = Math.max(0.02, (floorSum / floorN) * 2.5);
        } else if (rms > threshold) {
          quietSince = 0;
          if (!speechHeard) {
            speechHeard = true;
            onSpeech?.();
          }
        } else if (speechHeard && analyser) {
          if (!quietSince) quietSince = now;
          else if (now - quietSince >= silenceMs) return stop(false);
        }
        if (!speechHeard && elapsed >= noSpeechMs) return stop(true);
      }
      onLevel?.(level);
    };

    try {
      recorder.start(250); // timeslice so data arrives incrementally (iOS can otherwise return nothing)
    } catch {
      cleanup();
      return reject(new Error("No microphone found"));
    }
    poll = setInterval(tick, 50);
    maxTimer = setTimeout(() => stop(false), maxMs);
  });
}
