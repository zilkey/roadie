"use client";
import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useNoBand } from "@/components/welcome/useNoBand";

/** Signed in with Google but on no band's list yet: start a band, or wait to be added. */
export default function NoBand() {
  const { refresh, signOut } = useAuth();
  const me = useNoBand();
  const [checking, setChecking] = useState(false);
  const [still, setStill] = useState(false);
  if (!me) return <div className="grid min-h-dvh place-items-center s" data-testid="auth-loading">Loading…</div>;

  async function check() {
    setChecking(true); setStill(false);
    try { await refresh(); setStill(true); } catch { setStill(true); } finally { setChecking(false); }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 px-4 py-10" data-testid="no-band">
      <h1 className="page-title">No band yet</h1>
      <p>Signed in as <b data-testid="no-band-email">{me.email}</b>. That email isn&apos;t on a band&apos;s list yet.</p>
      <Link href="/start-band" className="btn acc" data-testid="start-band">Start a band</Link>
      <div className="card">
        <h2>Been invited?</h2>
        <p className="s">Ask your band&apos;s admin to add <b>{me.email}</b> under Settings, People. Once they have, check again.</p>
        <button type="button" className="btn ghost w-fit" data-testid="check-again" disabled={checking} onClick={check}>{checking ? "Checking…" : "Check again"}</button>
        {still && <p className="s" role="status" data-testid="still-no-band">Still not on a band&apos;s list.</p>}
      </div>
      <p className="s">Not you? <button type="button" className="underline" data-testid="sign-out" onClick={signOut}>Sign out</button></p>
    </main>
  );
}
