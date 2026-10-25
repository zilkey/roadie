"use client";
import { useState } from "react";
import type { Answer } from "@/lib/shows";

/** One date someone is asked about: from the signed-in member's asks, or from their no-login answer link. */
export interface DateAsk { id: string; date: string; title: string; closed: boolean; answer?: Answer; note?: string }

export const ANSWER_WORD: Record<Answer, string> = { yes: "Free", maybe: "Maybe", no: "Can't" };

/** Free / Maybe / Can't for one date, plus a note. A tap saves; so does leaving the note once there is an answer. */
export function DateAnswerCard({ ask, busy, onAnswer }: { ask: DateAsk; busy?: boolean; onAnswer(answer: Answer, note?: string): unknown }) {
  const [note, setNote] = useState(ask.note ?? "");
  const t = `answer-${ask.date}`;
  const save = (a: Answer) => onAnswer(a, note.trim() || undefined);
  return (
    <div className="card" data-testid={t}>
      <div className="flex items-baseline justify-between gap-2">
        <b className="text-[17px]">{ask.title}</b>
        {ask.closed ? <span className="s" data-testid={`${t}-closed`}>Closed</span> : ask.answer && <span className="s" data-testid={`${t}-saved`}>Saved</span>}
      </div>
      <div role="group" aria-label={ask.title} className="grid grid-cols-3 gap-2">
        {(["yes", "maybe", "no"] as const).map((a) => (
          <button key={a} type="button" className="ans" data-a={a} aria-pressed={ask.answer === a} disabled={busy || ask.closed}
            onClick={() => save(a)} data-testid={`${t}-${a}`}>{ANSWER_WORD[a]}</button>
        ))}
      </div>
      {!ask.closed && (
        <input className="input" value={note} maxLength={500} placeholder="Add a note (optional)" aria-label={`Note for ${ask.title}`}
          onChange={(e) => setNote(e.target.value)} onBlur={() => { if (ask.answer && note.trim() !== (ask.note ?? "")) save(ask.answer); }} data-testid={`${t}-note`} />
      )}
    </div>
  );
}

export const ANSWER_FOOT = "Answers save as you tap. You can change them any time.";
