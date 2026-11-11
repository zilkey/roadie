"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fmtLong } from "@/lib/shows";
import { ANSWER_FOOT, DateAnswerCard } from "@/components/shows/DateAnswers";
import type { LinkAsk, LinkView } from "@/server/availability";

type Answer = "yes" | "no" | "maybe";
const place = (label: string) => label.split(" · ")[0];

/** Public "Can you play?" page: every date this link asks about. No login: the token in the URL is checked server-side against its stored hash. */
export default function AskPage() {
  const { id, musicianId, token } = useParams<{ id: string; musicianId: string; token: string }>();
  const api = (avId: string) => `/api/availability/${encodeURIComponent(avId)}/${encodeURIComponent(musicianId)}/${encodeURIComponent(token)}`;
  const [view, setView] = useState<LinkView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(api(id)).then(async (r) => {
      const j = await r.json();
      if (!r.ok) return setProblem(j.error?.message ?? "This link is not valid.");
      setView(j);
    }).catch(() => setProblem("Could not load this question. Try again."));
  }, [id, musicianId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function answer(ask: LinkAsk, a: Answer, note?: string) {
    setBusy(true); setProblem(null);
    try {
      const r = await fetch(api(ask.availabilityId), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer: a, ...(note ? { note } : {}) }) });
      const j = await r.json();
      if (!r.ok) return setProblem(j.error?.message ?? "Could not save your answer.");
      setView((v) => (v ? { ...v, asks: v.asks.map((x) => (x.availabilityId === ask.availabilityId ? { ...x, answer: a, note } : x)) } : v));
    } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-start gap-4 p-4 pt-10" data-testid="ask-page">
      {problem && !view && <div className="card" data-testid="ask-problem"><span>{problem}</span></div>}
      {!view && !problem && <span className="s">Loading…</span>}
      {view && (
        <>
          <div className="grid gap-1.5">
            <h1 className="page-title">Can you play?</h1>
            <p className="s text-[15px]" data-testid="ask-label">{place(view.label)}. {view.askedBy} is asking. Tap an answer for each date.</p>
          </div>
          <div className="grid gap-3">
            {view.asks.map((x) => (
              <DateAnswerCard key={x.availabilityId} busy={busy} onAnswer={(a, note) => answer(x, a, note)}
                ask={{ id: x.availabilityId, date: x.date, title: fmtLong(x.date), closed: x.closed, answer: x.answer, note: x.note }} />
            ))}
          </div>
          {problem && <div className="err" role="alert" data-testid="error">{problem}</div>}
          <p className="s text-center">{ANSWER_FOOT}</p>
        </>
      )}
    </main>
  );
}
