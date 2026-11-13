"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { artistHeaders } from "@/lib/commands";
import { clientAuth } from "@/lib/firebase-client";
import type { AssistantAction, TranscribeResponse } from "@/schema/assistant";
import { speak, speechAvailable, stopSpeaking, unlockAudio } from "./speech";
import { micAvailable, record, releaseMic } from "./recorder";

export type VoicePhase = "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "answering";
type Turn = { reply: string; actions: AssistantAction[]; error?: string; stopped?: boolean } | null;
type Done = { status: "done" | "canceled" | "failed"; label?: string; message?: string } | null;

async function transcribe(blob: Blob, mimeType: string, mode: "message" | "answer", signal: AbortSignal): Promise<TranscribeResponse> {
  const ext = /mp4|aac/.test(mimeType) ? "m4a" : /ogg/.test(mimeType) ? "ogg" : /wav/.test(mimeType) ? "wav" : /mpeg|mp3/.test(mimeType) ? "mp3" : "webm";
  const form = new FormData();
  form.append("audio", blob, `speech.${ext}`);
  form.append("mode", mode);
  const token = await clientAuth().currentUser?.getIdToken();
  const res = await fetch("/api/assistant/transcribe", { method: "POST", headers: { authorization: `Bearer ${token}`, ...artistHeaders() }, body: form, signal });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message ?? "I couldn't hear that");
  return json as TranscribeResponse;
}

/** Talk to Roadie: record a question, send it as a voice turn, speak the reply, and listen once for yes or no on a voice-OK card. */
export function useVoice(r: { send(t: string, o?: { voice?: boolean }): Promise<Turn>; stop?(): void; answer(id: string, d: "yes" | "cancel", picks?: Record<string, string>, by?: "voice"): Promise<Done> }) {
  const [available, setAvailable] = useState(false);
  const [phase, setPhaseState] = useState<VoicePhase>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const run = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const api = useRef(r);
  api.current = r;

  useEffect(() => {
    alive.current = true;
    setAvailable(micAvailable() && speechAvailable());
    return () => { alive.current = false; run.current?.abort(); stopSpeaking(); releaseMic(); };
  }, []);

  const start = useCallback(async () => {
    unlockAudio(); // inside the tap, or iOS keeps the speaker locked
    run.current?.abort(); stopSpeaking(); // tapping while it speaks: stop and ask again
    const ctl = new AbortController();
    run.current = ctl;
    const { signal } = ctl;
    const live = () => alive.current && run.current === ctl && !signal.aborted;
    const phaseTo = (p: VoicePhase) => { if (live()) { setPhaseState(p); if (p !== "listening" && p !== "answering") setLevel(0); } };
    const say = async (t: string) => { phaseTo("speaking"); await speak(t, { signal }); };
    const hear = (o: { maxMs: number; silenceMs: number; noSpeechMs: number }) => record({ ...o, signal, onLevel: (l) => { if (live()) setLevel(l); } });
    setError(null);
    try {
      phaseTo("listening");
      const heard = await hear({ maxMs: 30000, silenceMs: 1500, noSpeechMs: 6000 });
      if (!heard || !live()) return;
      phaseTo("transcribing");
      const t = await transcribe(heard.blob, heard.mimeType, "message", signal);
      if (!live()) return;
      if (!t.text.trim()) { await say("Sorry, I didn't catch that."); return; }
      phaseTo("thinking");
      const turn = await api.current.send(t.text, { voice: true });
      if (!turn || turn.stopped || !live()) return;
      await say(turn.error ?? turn.reply);
      if (turn.error || !live()) return;
      const cards = turn.actions.filter((a) => a.kind === "confirm" && a.voice === true && (a.status ?? "pending") === "pending");
      const id = cards.length === 1 ? cards[0].pendingId : undefined;
      if (!id) return; // none, or several: the reply says to tap
      phaseTo("answering");
      const ans = await hear({ maxMs: 6000, silenceMs: 1200, noSpeechMs: 4000 });
      if (!live()) return;
      let decision: TranscribeResponse["answer"] = "unclear";
      if (ans) {
        phaseTo("transcribing");
        decision = (await transcribe(ans.blob, ans.mimeType, "answer", signal)).answer ?? "unclear";
        if (!live()) return;
      }
      if (decision === "yes") {
        phaseTo("thinking");
        const done = await api.current.answer(id, "yes", undefined, "voice");
        if (!live()) return;
        if (done?.status === "failed") await say(done.message ?? "That didn't work.");
        else if (done) await say(done.label && done.label.length <= 60 ? `Done. ${done.label}` : "Done.");
      } else if (decision === "cancel") {
        phaseTo("thinking");
        await api.current.answer(id, "cancel", undefined, "voice");
        if (!live()) return;
        await say("Okay, I left it alone.");
      } else await say("I'll leave the card for you.");
    } catch (e) {
      if (live()) setError(e instanceof Error && e.message ? e.message : "Voice didn't work");
    } finally {
      if (run.current === ctl) { run.current = null; if (alive.current) { setPhaseState("idle"); setLevel(0); } }
    }
  }, []);

  // The voice Stop button also stops a reply Roadie is still working on (the "Thinking…" part).
  const stop = useCallback(() => {
    if (run.current) api.current.stop?.();
    run.current?.abort(); run.current = null;
    stopSpeaking();
    if (alive.current) { setPhaseState("idle"); setLevel(0); }
  }, []);

  return { available, phase, level, start, stop, error };
}
