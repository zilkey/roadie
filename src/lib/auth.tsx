"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ArtistContext } from "./artist";
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signOut as fbSignOut, type User } from "firebase/auth";
import { clientAuth } from "./firebase-client";

/** One artist you can open, and your role there (from /api/session). */
export interface ArtistAccess { artistId: string; slug: string; name: string; role: "admin" | "member" }
export interface Profile { uid: string; userId: string; name: string; email: string; musicianId?: string; mcpAccess: boolean; artists: ArtistAccess[] }
type State =
  | { status: "loading" }
  | { status: "signedOut"; error?: string }
  /** Signed in with a verified Google account that is on no band's list yet: they can start a band. Stays signed in to Firebase. */
  | { status: "noBand"; user: User; email: string; name: string }
  /** Turned away (an AI-tools-only login, or a removed person): signed out of Firebase. */
  | { status: "notInvited"; email?: string }
  | { status: "ready"; user: User; profile: Profile };

interface AuthApi {
  state: State; signInWithGoogle(): Promise<void>; devSignIn(p: { key: string; name: string; email: string }): Promise<void>; signOut(): Promise<void>;
  /** Ask the server again (your artists, their slugs and your roles changed, or you started a band) and pick up new claims. */
  refresh(): Promise<void>;
}
const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async (user: User): Promise<State> => {
    const res = await fetch("/api/session", { method: "POST", headers: { authorization: `Bearer ${await user.getIdToken()}` } });
    const json = await res.json().catch(() => ({}));
    if (res.status === 403 && json.error?.code === "not_invited") return { status: "notInvited", email: user.email ?? undefined };
    if (!res.ok) throw new Error(json.error?.message ?? "Sign-in failed");
    await user.getIdToken(true); // pick up the new custom claims
    if (json.status === "noBand") return { status: "noBand", user, email: json.email ?? user.email ?? "", name: json.name ?? "" };
    return { status: "ready", user, profile: json as Profile };
  }, []);

  useEffect(() => {
    const auth = clientAuth();
    let cancelled = false;
    const off = onAuthStateChanged(auth, async (user) => {
      if (!user) return setState((s) => (s.status === "notInvited" ? s : { status: "signedOut" }));
      setState({ status: "loading" });
      try {
        const next = await load(user);
        if (cancelled) return;
        setState(next);
        if (next.status === "notInvited") await fbSignOut(auth);
      } catch (e) {
        await fbSignOut(auth);
        if (!cancelled) setState({ status: "signedOut", error: e instanceof Error ? e.message : "Sign-in failed" });
      }
    });
    return () => { cancelled = true; off(); };
  }, [load]);

  const refresh = useCallback(async () => {
    const user = clientAuth().currentUser;
    if (!user) return;
    const next = await load(user);
    if (next.status === "ready" || next.status === "noBand") setState(next);
  }, [load]);

  const signInWithGoogle = useCallback(async () => { await signInWithPopup(clientAuth(), new GoogleAuthProvider()); }, []);
  const devSignIn = useCallback(async (p: { key: string; name: string; email: string }) => {
    const cred = GoogleAuthProvider.credential(JSON.stringify({ sub: `dev-${p.key}`, email: p.email, email_verified: true, name: p.name }));
    await signInWithCredential(clientAuth(), cred);
  }, []);
  const signOut = useCallback(async () => { await fbSignOut(clientAuth()); setState({ status: "signedOut" }); }, []);

  const api = useMemo(() => ({ state, signInWithGoogle, devSignIn, signOut, refresh }), [state, signInWithGoogle, devSignIn, signOut, refresh]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
/** Only inside an artist (/artists/[slug]): you, with your `role` in that artist. */
export function useProfile(): Profile & { role: "admin" | "member" } {
  const { state } = useAuth();
  const artist = useContext(ArtistContext);
  if (state.status !== "ready") throw new Error("useProfile before sign-in");
  if (!artist) throw new Error("useProfile outside an artist");
  return { ...state.profile, role: artist.role };
}
