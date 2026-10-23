"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { usingEmulators } from "@/lib/firebase-client";
import { DEV_PEOPLE, DEV_STRANGER } from "@/lib/dev-people";

export default function SignIn() {
  const { state, signInWithGoogle, devSignIn } = useAuth();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === "ready") router.replace("/artists");
    if (state.status === "notInvited") router.replace("/not-invited");
  }, [state.status, router]);

  const go = (fn: () => Promise<void>) => fn().catch((e) => setErr(e instanceof Error ? e.message : "Sign-in failed"));

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-5 px-4 py-10">
      <div className="grid gap-1">
        <h1 className="text-3xl">Band Tracker</h1>
        <p className="s">Ingrid Avison Band. Sign in with the Google account we invited.</p>
      </div>
      {(err || (state.status === "signedOut" && state.error)) && <div className="err">{err ?? (state as { error?: string }).error}</div>}
      <button className="btn acc" data-testid="google-signin" onClick={() => go(signInWithGoogle)}>Sign in with Google</button>
      {usingEmulators && (
        <div className="card" data-testid="dev-signin">
          <span className="lbl">Dev only: sign in as…</span>
          <div className="flex flex-wrap gap-2">
            {DEV_PEOPLE.map((p) => (
              <button key={p.key} className="btn ghost sm" data-testid={`dev-${p.key}`} onClick={() => go(() => devSignIn(p))}>
                {p.name} <span className={`chip ${p.role === "admin" ? "a" : "m"}`}>{p.role}</span>
              </button>
            ))}
            <button className="btn ghost sm" data-testid={`dev-${DEV_STRANGER.key}`} onClick={() => go(() => devSignIn(DEV_STRANGER))}>
              {DEV_STRANGER.name} <span className="chip">not invited</span>
            </button>
          </div>
        </div>
      )}
      {state.status === "loading" && <p className="s">Signing in…</p>}
    </main>
  );
}
