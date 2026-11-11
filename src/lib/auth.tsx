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
  | { status: "ready"; user: User; profile: Profile }
  /** Still signed in, but Roadie couldn't be reached (no signal, a server hiccup). Retries on its own; never signs you out. */
  | { status: "offline"; user: User };

interface AuthApi {
  state: State; signInWithGoogle(): Promise<void>; devSignIn(p: { key: string; name: string; email: string }): Promise<void>; signOut(): Promise<void>;
  /** Ask the server again (your artists, their slugs and your roles changed, or you started a band) and pick up new claims. */
  refresh(): Promise<void>;
  /** After "offline": ask the server again now. */
  retry(): void;
}

/** The server couldn't be asked (no network, a timeout, a 5xx). Not a "no": the Firebase sign-in is kept. */
class Unreachable extends Error {}
/** Only a 401/403 from /api/session means you're not let in; anything else is a hiccup. */
const refused = (status: number) => status === 401 || status === 403;
const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async (user: User): Promise<State> => {
    let res: Response;
    try {
      res = await fetch("/api/session", { method: "POST", headers: { authorization: `Bearer ${await user.getIdToken()}` } });
    } catch {
      throw new Unreachable(); // offline, or the token couldn't be refreshed without a network
    }
    const json = await res.json().catch(() => ({}));
    if (res.status === 403 && json.error?.code === "not_invited") return { status: "notInvited", email: user.email ?? undefined };
    if (refused(res.status)) throw new Error(json.error?.message ?? "Sign-in failed");
    if (!res.ok) throw new Unreachable();
    try { await user.getIdToken(true); } catch { throw new Unreachable(); } // pick up the new custom claims
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
        if (cancelled) return;
        if (e instanceof Unreachable) return setState({ status: "offline", user });
        await fbSignOut(auth);
        if (!cancelled) setState({ status: "signedOut", error: e instanceof Error ? e.message : "Sign-in failed" });
      }
    });
    return () => { cancelled = true; off(); };
  }, [load]);

  // Once you're in, ask the browser never to clear Roadie's storage (where the sign-in lives) to free up space. Chrome
  // says yes for an installed app; elsewhere it may say no, which changes nothing.
  const signedIn = state.status === "ready";
  useEffect(() => {
    if (!signedIn || !navigator.storage?.persist) return;
    void navigator.storage.persisted().then((yes) => (yes ? true : navigator.storage.persist())).catch(() => {});
  }, [signedIn]);

  // Offline: try again when the phone gets a connection back, when the app comes back to the front, and every 15 seconds.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const offlineUser = state.status === "offline" ? state.user : null;
  useEffect(() => {
    if (!offlineUser) return;
    const wake = () => { if (document.visibilityState === "visible") retry(); };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", wake);
    const t = setInterval(retry, 15_000);
    return () => { window.removeEventListener("online", retry); document.removeEventListener("visibilitychange", wake); clearInterval(t); };
  }, [offlineUser, retry]);
  useEffect(() => {
    if (!attempt || !offlineUser) return;
    let cancelled = false;
    load(offlineUser).then(
      async (next) => {
        if (cancelled || clientAuth().currentUser?.uid !== offlineUser.uid) return;
        setState(next);
        if (next.status === "notInvited") await fbSignOut(clientAuth());
      },
      async (e) => {
        if (cancelled || e instanceof Unreachable) return; // still offline: stay put, the next try comes
        await fbSignOut(clientAuth());
        setState({ status: "signedOut", error: e instanceof Error ? e.message : "Sign-in failed" });
      },
    );
    return () => { cancelled = true; };
  }, [attempt, offlineUser, load]);

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

  const api = useMemo(() => ({ state, signInWithGoogle, devSignIn, signOut, refresh, retry }), [state, signInWithGoogle, devSignIn, signOut, refresh, retry]);
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
