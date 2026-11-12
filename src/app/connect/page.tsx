"use client";
/**
 * Connecting Claude (or another MCP client) to Roadie: /oauth/authorize sends the browser here with the sealed request
 * in `?req=`. You sign in with Google (or are already signed in), pick the artist, and we go back to the client with a
 * code (mcp/oauth.ts). Outside the (signed-in) group on purpose: AuthProvider turns away AI-only logins, and those are
 * exactly the people who connect this way. It only reads Firebase's sign-in, never /api/session.
 */
import { useCallback, useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signInWithRedirect, signOut, type User } from "firebase/auth";
import { clientAuth, usingEmulators } from "@/lib/firebase-client";
import type { DevSignInPerson } from "@/app/api/dev-people/route";

interface Artist { artistId: string; name: string; ai: boolean }
interface Info { client: string; returnTo: string; name: string; artists: Artist[] }
type State =
  | { s: "loading" }
  | { s: "signedOut" }
  | { s: "choose"; user: User; info: Info }
  | { s: "going" }
  | { s: "error"; message: string; user?: User };

async function approve(req: string, user: User | null, extra: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (user) headers.authorization = `Bearer ${await user.getIdToken()}`;
  const res = await fetch("/oauth/approve", { method: "POST", headers, body: JSON.stringify({ req, ...extra }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message ?? "Something went wrong. Try again.");
  return json;
}

export default function Connect() {
  const [req, setReq] = useState<string | null>(null);
  const [state, setState] = useState<State>({ s: "loading" });
  const [picked, setPicked] = useState<string>("");
  const [people, setPeople] = useState<DevSignInPerson[]>([]);

  useEffect(() => { setReq(new URLSearchParams(location.search).get("req") ?? ""); }, []);

  useEffect(() => {
    if (req === null) return;
    if (!req) return setState({ s: "error", message: "This page opens from Claude when you connect Roadie. Start again from Claude." });
    return onAuthStateChanged(clientAuth(), async (user) => {
      if (!user) return setState({ s: "signedOut" });
      setState({ s: "loading" });
      try {
        const info = (await approve(req, user)) as Info;
        setPicked(info.artists.find((a) => a.ai)?.artistId ?? "");
        setState({ s: "choose", user, info });
      } catch (e) {
        setState({ s: "error", message: e instanceof Error ? e.message : "Something went wrong", user });
      }
    });
  }, [req]);

  useEffect(() => {
    if (!usingEmulators) return;
    fetch("/api/dev-people").then((r) => r.json()).then((d) => setPeople(d.people ?? [])).catch(() => {});
  }, []);

  const google = useCallback(async () => {
    const auth = clientAuth();
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) {
      const code = (e as { code?: string }).code ?? "";
      // In-app browsers (Claude on a phone) often can't open a popup: go the long way round, back to this same page.
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") return signInWithRedirect(auth, new GoogleAuthProvider());
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") setState({ s: "error", message: "Sign-in failed. Try again." });
    }
  }, []);
  const dev = (p: DevSignInPerson) =>
    signInWithCredential(clientAuth(), GoogleAuthProvider.credential(JSON.stringify({ sub: `dev-${p.key}`, email: p.email, email_verified: true, name: p.name })));

  const go = async (extra: Record<string, unknown>, user: User | null) => {
    if (!req) return;
    setState({ s: "going" });
    try {
      const { redirect } = await approve(req, user, extra);
      location.assign(redirect);
    } catch (e) {
      setState({ s: "error", message: e instanceof Error ? e.message : "Something went wrong", user: user ?? undefined });
    }
  };
  const switchAccount = async () => { await signOut(clientAuth()); setState({ s: "signedOut" }); };

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-5 px-4 py-10" data-testid="connect">
      <h1 className="m-0"><img src="/logo-signin.svg" alt="Roadie" width={200} height={146} /></h1>

      {state.s === "loading" && <p className="s">Checking…</p>}
      {state.s === "going" && <p className="s">Taking you back…</p>}

      {state.s === "signedOut" && (
        <>
          <div className="grid gap-1">
            <h2 className="font-display text-xl font-bold m-0">Connect Roadie to Claude</h2>
            <p className="s">Sign in with the Google account you use for Roadie.</p>
          </div>
          <button className="btn acc" data-testid="connect-google" onClick={google}>Sign in with Google</button>
          {usingEmulators && people.length > 0 && (
            <div className="card" data-testid="connect-dev">
              <span className="lbl">Dev only: sign in as…</span>
              <div className="flex flex-wrap gap-2">
                {people.map((p) => <button key={p.key} className="btn ghost sm" data-testid={`connect-dev-${p.key}`} onClick={() => dev(p)}>{p.name}</button>)}
              </div>
            </div>
          )}
          <button className="btn ghost" onClick={() => go({ cancel: true }, null)}>Cancel</button>
        </>
      )}

      {state.s === "choose" && (() => {
        const { info, user } = state;
        const usable = info.artists.filter((a) => a.ai);
        return (
          <>
            <div className="grid gap-1">
              <h2 className="font-display text-xl font-bold m-0">Connect Roadie to {info.client}</h2>
              <p className="s">Signed in as <b>{user.email ?? info.name}</b>. <button className="link" onClick={switchAccount} data-testid="connect-switch">Not you?</button></p>
            </div>
            {usable.length === 0 ? (
              <div className="err" data-testid="connect-no-access">
                You don&apos;t have AI access in {info.artists.length === 1 ? info.artists[0].name : "any of your artists"} yet. Ask a band admin to turn on <b>AI (MCP) access</b> for you in People, then try again.
              </div>
            ) : (
              <fieldset className="grid gap-2">
                <legend className="lbl mb-1">Which artist?</legend>
                {info.artists.map((a) => (
                  <label key={a.artistId} className={`card flex items-center gap-3 ${a.ai ? "" : "opacity-60"}`}>
                    <input type="radio" name="artist" value={a.artistId} checked={picked === a.artistId} disabled={!a.ai} onChange={() => setPicked(a.artistId)} data-testid={`connect-artist-${a.artistId}`} />
                    <span className="grid"><b>{a.name}</b>{!a.ai && <span className="s">No AI access here</span>}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <p className="s">
              {info.client} will act as you in Roadie: it can look things up and make changes, and everything it changes shows in History.
              It can draft emails but never send them. You&apos;ll go back to <b>{info.returnTo}</b>.
            </p>
            <div className="flex gap-2">
              <button className="btn ghost flex-1" onClick={() => go({ cancel: true }, user)} data-testid="connect-cancel">Cancel</button>
              <button className="btn acc flex-1" disabled={!picked} onClick={() => go({ artistId: picked }, user)} data-testid="connect-allow">Connect</button>
            </div>
          </>
        );
      })()}

      {state.s === "error" && (
        <>
          <div className="err" data-testid="connect-error">{state.message}</div>
          {state.user && <button className="btn ghost" onClick={switchAccount}>Use a different account</button>}
        </>
      )}
    </main>
  );
}
