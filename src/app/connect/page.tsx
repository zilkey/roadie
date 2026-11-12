"use client";
/**
 * Connecting Claude (or another MCP client) to Roadie: you pick the artist here, and we go back to the client with a
 * code (mcp/oauth.ts). `?req=` is the sealed request.
 *
 * Who you are comes one of two ways:
 * - Production: you already signed in on Google's own page (server-side, by redirects) and arrive with `?who=`. No
 *   Firebase in the browser at all, because in Claude's in-app sign-in window on iPhone Firebase's popup never reports
 *   back and its sign-in state can take many seconds to load.
 * - Dev and tests (no Google OAuth client): Firebase sign-in on this page, with the emulator's dev buttons.
 * Outside the (signed-in) group on purpose: AuthProvider turns away AI-only logins, and those are exactly the people
 * who connect this way. It never calls /api/session.
 */
import { useCallback, useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithCredential, signInWithPopup, signInWithRedirect, signOut, type User } from "firebase/auth";
import { clientAuth, usingEmulators } from "@/lib/firebase-client";
import type { DevSignInPerson } from "@/app/api/dev-people/route";

interface Artist { artistId: string; name: string; ai: boolean }
interface Info { client: string; returnTo: string; name: string; email?: string; artists: Artist[] }
/** Who is connecting: Google already said (sealed `who` from the server), or a Firebase sign-in on this page. */
type Id = { who: string } | { user: User };
type State =
  | { s: "loading" }
  | { s: "signedOut"; note?: string }
  | { s: "choose"; id: Id; info: Info }
  | { s: "going" }
  | { s: "error"; message: string; id?: Id; retry?: boolean };

/** In-app browsers (Claude on a phone) can leave Firebase's sign-in or token refresh hanging: never wait forever. */
class Stalled extends Error {}
const within = <T,>(p: Promise<T>, ms: number, step: string) =>
  Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Stalled(step)), ms))]);
/** Tell the server which step stalled, so it shows in the logs (the page runs on someone's phone). */
const report = (step: string, detail = "") => {
  try { navigator.sendBeacon("/oauth/log", JSON.stringify({ step, detail: detail.slice(0, 200), ua: navigator.userAgent.slice(0, 200) })); } catch { /* best effort */ }
};

async function approve(req: string, id: Id | null, extra: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (id && "who" in id) extra = { ...extra, who: id.who };
  const user = id && "user" in id ? id.user : null;
  if (user) headers.authorization = `Bearer ${await within(user.getIdToken(), 15_000, "token")}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  let res: Response;
  try { res = await fetch("/oauth/approve", { method: "POST", headers, body: JSON.stringify({ req, ...extra }), signal: ctl.signal }); }
  catch { throw new Stalled("approve"); }
  finally { clearTimeout(t); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message ?? "Something went wrong. Try again.");
  return json;
}

export default function Connect() {
  const [req, setReq] = useState<string | null>(null);
  const [who, setWho] = useState<string>("");
  const [state, setState] = useState<State>({ s: "loading" });
  const [picked, setPicked] = useState<string>("");
  const [people, setPeople] = useState<DevSignInPerson[]>([]);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    setWho(q.get("who") ?? "");
    setReq(q.get("req") ?? "");
  }, []);

  const load = useCallback(async (id: Id) => {
    if (!req) return;
    setState({ s: "loading" });
    try {
      const info = (await approve(req, id)) as Info;
      setPicked(info.artists.find((a) => a.ai)?.artistId ?? "");
      setState({ s: "choose", id, info });
    } catch (e) {
      if (e instanceof Stalled) {
        report(e.message);
        return setState({ s: "error", message: "Roadie is taking too long to answer. Check your connection and try again.", id, retry: true });
      }
      setState({ s: "error", message: e instanceof Error ? e.message : "Something went wrong", id });
    }
  }, [req]);

  useEffect(() => {
    if (req === null) return;
    if (!req) return setState({ s: "error", message: "This page opens from Claude when you connect Roadie. Start again from Claude." });
    if (who) { void load({ who }); return; }
    const auth = clientAuth();
    let settled = false;
    // If Firebase never says who is signed in (it can hang in an in-app browser), offer sign-in instead of "Checking…" forever.
    const t = setTimeout(() => {
      if (settled) return;
      report("auth-state");
      setState({ s: "signedOut", note: "Couldn't check whether you're signed in. Sign in to carry on." });
    }, 8_000);
    const off = onAuthStateChanged(auth, (user) => {
      settled = true;
      clearTimeout(t);
      if (!user) return setState((st) => (st.s === "signedOut" ? st : { s: "signedOut" }));
      void load({ user });
    });
    return () => { clearTimeout(t); off(); };
  }, [req, who, load]);

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

  const go = async (extra: Record<string, unknown>, id: Id | null) => {
    if (!req) return;
    setState({ s: "going" });
    try {
      const { redirect } = await approve(req, id, extra);
      location.assign(redirect);
    } catch (e) {
      if (e instanceof Stalled) report(e.message, "connect");
      const message = e instanceof Stalled ? "Roadie is taking too long to answer. Check your connection and try again." : e instanceof Error ? e.message : "Something went wrong";
      setState({ s: "error", message, id: id ?? undefined, retry: e instanceof Stalled });
    }
  };
  /** Google's account chooser again (production), or sign out of Firebase (dev). */
  const switchAccount = async () => {
    if (who && req) return location.assign(`/oauth/login?${new URLSearchParams({ req })}`);
    await signOut(clientAuth());
    setState({ s: "signedOut" });
  };

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
          {state.note && <p className="s" data-testid="connect-note">{state.note}</p>}
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
        const { info, id } = state;
        const usable = info.artists.filter((a) => a.ai);
        return (
          <>
            <div className="grid gap-1">
              <h2 className="font-display text-xl font-bold m-0">Connect Roadie to {info.client}</h2>
              <p className="s">Signed in as <b>{info.email ?? info.name}</b>. <button className="link" onClick={switchAccount} data-testid="connect-switch">Not you?</button></p>
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
              <button className="btn ghost flex-1" onClick={() => go({ cancel: true }, id)} data-testid="connect-cancel">Cancel</button>
              <button className="btn acc flex-1" disabled={!picked} onClick={() => go({ artistId: picked }, id)} data-testid="connect-allow">Connect</button>
            </div>
          </>
        );
      })()}

      {state.s === "error" && (
        <>
          <div className="err" data-testid="connect-error">{state.message}</div>
          {state.retry && state.id && <button className="btn acc" data-testid="connect-retry" onClick={() => load(state.id!)}>Try again</button>}
          {(state.id || who) && <button className="btn ghost" onClick={switchAccount} data-testid="connect-other-account">Use a different account</button>}
        </>
      )}
    </main>
  );
}
