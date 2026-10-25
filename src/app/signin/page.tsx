"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { usingEmulators } from "@/lib/firebase-client";
import { DEV_STRANGER } from "@/lib/dev-people";
import type { DevSignInPerson } from "@/app/api/dev-people/route";

export default function SignIn() {
  const { state, signInWithGoogle, devSignIn } = useAuth();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  // Who is actually seeded, rather than a hardcoded roster: the emulator may hold the demo people (scripts/seed.ts)
  // or the real band (scripts/seed-real.ts), and offering the wrong ones lands on /not-invited with no data.
  const [people, setPeople] = useState<DevSignInPerson[]>([]);

  useEffect(() => {
    if (!usingEmulators) return;
    fetch("/api/dev-people")
      .then((r) => r.json() as Promise<{ people: DevSignInPerson[] }>)
      .then((d) => setPeople(d.people))
      .catch(() => setPeople([]));
  }, []);

  useEffect(() => {
    if (state.status === "ready") router.replace("/artists");
    if (state.status === "notInvited") router.replace("/not-invited");
  }, [state.status, router]);

  const go = (fn: () => Promise<void>) => fn().catch((e) => setErr(e instanceof Error ? e.message : "Sign-in failed"));

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-5 px-4 py-10">
      <div className="grid gap-1">
        <h1 className="page-title">Roadie</h1>
        <p className="s">Ingrid Avison Band. Sign in with the Google account we invited.</p>
      </div>
      {(err || (state.status === "signedOut" && state.error)) && <div className="err">{err ?? (state as { error?: string }).error}</div>}
      <button className="btn acc" data-testid="google-signin" onClick={() => go(signInWithGoogle)}>Sign in with Google</button>
      {usingEmulators && (
        <div className="card" data-testid="dev-signin">
          <span className="lbl">Dev only: sign in as…</span>
          <div className="flex flex-wrap gap-2">
            {people.map((p) => (
              <button key={p.key} className="btn ghost sm" data-testid={`dev-${p.key}`} onClick={() => go(() => devSignIn(p))}>
                {p.name} <span className={`chip ${p.role === "admin" ? "a" : "m"}`}>{p.role}</span>
                {p.artistName && <span className="chip">{p.artistName}</span>}
              </button>
            ))}
            <button className="btn ghost sm" data-testid={`dev-${DEV_STRANGER.key}`} onClick={() => go(() => devSignIn(DEV_STRANGER))}>
              {DEV_STRANGER.name} <span className="chip">not invited</span>
            </button>
          </div>
          {!people.length && <p className="s">Nobody is seeded yet: run <code>npm run seed</code> (demo data) or <code>npm run seed:real</code> (the real band).</p>}
        </div>
      )}
      {state.status === "loading" && <p className="s">Signing in…</p>}
    </main>
  );
}
