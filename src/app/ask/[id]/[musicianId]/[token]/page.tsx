"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fmtLongYear } from "@/lib/shows";

interface View { musicianName: string; label: string; date: string; askedBy: string; closed: boolean; answer?: "yes" | "no" | "maybe"; note?: string }
const WORD = { yes: "Yes", no: "No", maybe: "Maybe" } as const;

/** Public "Can you play?" page. No login: the token in the URL is checked server-side against its stored hash. */
export default function AskPage() {
  const { id, musicianId, token } = useParams<{ id: string; musicianId: string; token: string }>();
  const url = `/api/availability/${encodeURIComponent(id)}/${encodeURIComponent(musicianId)}/${encodeURIComponent(token)}`;
  const [view, setView] = useState<View | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(url).then(async (r) => {
      const j = await r.json();
      if (!r.ok) return setProblem(j.error?.message ?? "This link is not valid.");
      setView(j); setNote(j.note ?? "");
    }).catch(() => setProblem("Could not load this question. Try again."));
  }, [url]);

  async function answer(a: "yes" | "no" | "maybe") {
    setBusy(true); setProblem(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer: a, ...(note.trim() ? { note: note.trim() } : {}) }) });
      const j = await r.json();
      if (!r.ok) return setProblem(j.error?.message ?? "Could not save your answer.");
      setView((v) => (v ? { ...v, answer: a, note: note.trim() || undefined } : v)); setDone(true);
    } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-start gap-3 p-4 pt-10" data-testid="ask-page">
      <h1 className="page-title">Can you play?</h1>
      {problem && !view && <div className="card" data-testid="ask-problem"><span>{problem}</span></div>}
      {!view && !problem && <span className="s">Loading…</span>}
      {view && (
        <>
          <div className="card">
            <b data-testid="ask-label">{view.label}</b>
            <span className="s">{fmtLongYear(view.date)} · asked by {view.askedBy}</span>
            <span className="s">Hi {view.musicianName}.</span>
          </div>
          {view.closed ? (
            <div className="card" data-testid="ask-closed"><span>This question is closed.{view.answer ? ` You answered ${WORD[view.answer]}.` : ""}</span></div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button className={`btn ${view.answer === "yes" ? "acc" : "ghost"}`} disabled={busy} onClick={() => answer("yes")} data-testid="answer-yes">Yes</button>
                <button className={`btn ${view.answer === "no" ? "acc" : "ghost"}`} disabled={busy} onClick={() => answer("no")} data-testid="answer-no">No</button>
              </div>
              <button className={`btn ${view.answer === "maybe" ? "acc" : "ghost"}`} disabled={busy} onClick={() => answer("maybe")} data-testid="answer-maybe">Maybe</button>
              <textarea className="input" rows={2} placeholder="Add a note (optional)…" value={note} onChange={(e) => setNote(e.target.value)} data-testid="answer-note" />
              <span className="s">You can change your answer until {view.askedBy} closes it.</span>
            </>
          )}
          {view.answer && !view.closed && <div className="chip g self-start" data-testid="answer-saved">{done ? "Saved. " : ""}You said {WORD[view.answer]}</div>}
          {problem && <div className="err" role="alert" data-testid="error">{problem}</div>}
        </>
      )}
    </main>
  );
}
