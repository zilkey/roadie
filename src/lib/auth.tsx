"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signOut as fbSignOut, type User } from "firebase/auth";
import { clientAuth } from "./firebase-client";

export interface Profile { uid: string; userId: string; name: string; email: string; role: "admin" | "member"; musicianId?: string; mcpAccess: boolean }
type State =
  | { status: "loading" }
  | { status: "signedOut"; error?: string }
  | { status: "notInvited"; email?: string }
  | { status: "ready"; user: User; profile: Profile };

interface AuthApi { state: State; signInWithGoogle(): Promise<void>; devSignIn(p: { key: string; name: string; email: string }): Promise<void>; signOut(): Promise<void> }
const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const auth = clientAuth();
    let cancelled = false;
    return onAuthStateChanged(auth, async (user) => {
      if (!user) return setState((s) => (s.status === "notInvited" ? s : { status: "signedOut" }));
      setState({ status: "loading" });
      try {
        const res = await fetch("/api/session", { method: "POST", headers: { authorization: `Bearer ${await user.getIdToken()}` } });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 403 && json.error?.code === "not_invited") {
          setState({ status: "notInvited", email: user.email ?? undefined });
          await fbSignOut(auth);
          return;
        }
        if (!res.ok) throw new Error(json.error?.message ?? "Sign-in failed");
        await user.getIdToken(true); // pick up the new custom claims
        setState({ status: "ready", user, profile: json as Profile });
      } catch (e) {
        await fbSignOut(auth);
        if (!cancelled) setState({ status: "signedOut", error: e instanceof Error ? e.message : "Sign-in failed" });
      }
    });
  }, []);

  const signInWithGoogle = useCallback(async () => { await signInWithPopup(clientAuth(), new GoogleAuthProvider()); }, []);
  const devSignIn = useCallback(async (p: { key: string; name: string; email: string }) => {
    const cred = GoogleAuthProvider.credential(JSON.stringify({ sub: `dev-${p.key}`, email: p.email, email_verified: true, name: p.name }));
    await signInWithCredential(clientAuth(), cred);
  }, []);
  const signOut = useCallback(async () => { await fbSignOut(clientAuth()); setState({ status: "signedOut" }); }, []);

  const api = useMemo(() => ({ state, signInWithGoogle, devSignIn, signOut }), [state, signInWithGoogle, devSignIn, signOut]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
/** Only inside the signed-in shell. */
export function useProfile(): Profile {
  const { state } = useAuth();
  if (state.status !== "ready") throw new Error("useProfile before sign-in");
  return state.profile;
}
