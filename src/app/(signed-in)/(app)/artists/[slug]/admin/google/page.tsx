"use client";
import { useEffect, useRef, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { runCommand } from "@/lib/commands";

type Feature = "calendar" | "gmail" | "drive";
interface Status {
  configured: boolean;
  me: { googleEmail: string; features: Feature[] } | null;
  band: { email: string; name: string; isMe: boolean; features: Feature[] } | null;
  missing?: Feature[];
}

/** Order and wording from the setup wireframe ("Connect Google for ..."). */
const FEATURES: [Feature, string, string][] = [
  ["calendar", "Calendar", "shows on everyone's calendar"],
  ["gmail", "Gmail", "send pitches and “can you play?” emails"],
  ["drive", "Drive", "song files, sharing checks and receipts"],
];
const NAMES: Record<Feature, string> = { calendar: "Calendar", gmail: "Gmail", drive: "Drive" };
const list = (fs: Feature[]) => FEATURES.filter(([f]) => fs.includes(f)).map(([, n]) => n).join(", ");

export default function GooglePage() { return <AdminOnly><GoogleSettings /></AdminOnly>; }

/**
 * Settings > Google. Each admin connects their own Google account for the features they tick; Google's consent page
 * comes back through /api/google/callback to this page with ?code&state, which finishes the connection here.
 */
function GoogleSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const { call, error, busy, setError } = useCommand();
  const [picked, setPicked] = useState<Feature[]>(["calendar", "gmail"]);
  const [note, setNote] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    const code = q.get("code"), state = q.get("state"), denied = q.get("error");
    if (code || denied) window.history.replaceState(null, "", window.location.pathname);
    if (denied) setError(denied === "access_denied" ? "Google wasn't connected: access was declined." : `Google: ${denied}`);
    const load = code && state
      ? runCommand<Status>("google.finishConnect", { code, state }).then((s) => {
        if (s.missing?.length) setNote(`Google didn't grant ${list(s.missing)}. Tick it and connect again to allow it.`);
        else setNote("Connected.");
        return s;
      })
      : runCommand<Status>("google.status", {});
    load.then(setStatus, (e: Error) => { setError(e.message); runCommand<Status>("google.status", {}).then(setStatus, () => undefined); });
  }, [setError]);

  useEffect(() => { if (status?.me) setPicked(status.me.features.length ? status.me.features : ["calendar", "gmail"]); }, [status?.me]);

  async function connect() {
    const r = await call<{ url: string }>("google.connectUrl", { features: picked });
    if (r) window.location.assign(r.url);
  }
  async function act(name: "google.disconnect" | "google.useForBand") {
    setNote(null);
    const s = await call<Status>(name, {});
    if (s) setStatus(s);
  }

  const me = status?.me;
  const adds = picked.some((f) => !me?.features.includes(f));
  return (
    <div className="grid gap-5">
      <PageTitle title="Google" sub="Send pitches from your own Gmail, put shows on everyone's calendar, and find song files in Drive." />
      {!status ? <p className="s" data-testid="google-loading">Loading…</p> : !status.configured ? (
        <section className="card" data-testid="google-not-configured">
          <div className="card-head"><h2>Not set up on this server</h2></div>
          <p className="m-0">Google sign-in for Gmail, Calendar and Drive needs an OAuth client on the server (<code>GOOGLE_OAUTH_CLIENT_ID</code>; see docs/FIREBASE-SETUP.md). Until then, email, calendar events and Drive go to the local fakes.</p>
        </section>
      ) : (
        <>
          <section className="card" data-testid="google-me" aria-labelledby="google-me-title">
            <div className="card-head"><h2 id="google-me-title">Your Google account</h2>{me && <span className="tag" data-testid="google-me-email">{me.googleEmail}</span>}</div>
            <p className="m-0" data-testid="google-me-status">
              {me?.features.length ? <>Connected for {list(me.features)}.</> : "Not connected. Roadie only gets the parts you tick, and you can disconnect any time."}
            </p>
            <div className="grid gap-0">
              <span className="lbl">Connect Google for</span>
              {FEATURES.map(([f, name, what]) => (
                <label key={f} className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 self-start">
                  <input type="checkbox" className="m-0 h-[18px] w-[18px]" checked={picked.includes(f)} data-testid={`google-pick-${f}`}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, f] : p.filter((x) => x !== f)))} />
                  <span><b>{name}</b> <span className="s">· {what}</span></span>
                </label>
              ))}
            </div>
            {note && <p className="s m-0" role="status" data-testid="google-note">{note}</p>}
            <ErrorBox error={error} />
            <div className="card-foot"><div className="end">
              {me && <button type="button" className="btn text" disabled={busy} onClick={() => act("google.disconnect")} data-testid="google-disconnect">Disconnect</button>}
              <button type="button" className="btn acc" disabled={busy || !picked.length} onClick={connect} data-testid="google-connect">
                {!me ? "Connect Google" : adds ? "Add to connection" : "Reconnect"}
              </button>
            </div></div>
          </section>

          <section className="card" data-testid="google-band" aria-labelledby="google-band-title">
            <div className="card-head"><h2 id="google-band-title">Band calendar and Drive</h2></div>
            <p className="m-0" data-testid="google-band-status">
              {status.band
                ? <>Shows go on <b>{status.band.isMe ? "your" : `${status.band.name}’s`}</b> Google Calendar ({status.band.email}), with invites to the people playing, and Drive searches look in {status.band.isMe ? "your" : "their"} Drive.
                  {(["calendar", "drive"] as Feature[]).filter((f) => !status.band!.features.includes(f)).map((f) => <span key={f}> {NAMES[f]} isn&apos;t connected on it yet.</span>)}</>
                : "No one's Google account is set for the band yet. The first admin to connect Calendar or Drive becomes it."}
            </p>
            {me && !status.band?.isMe && (me.features.includes("calendar") || me.features.includes("drive")) && (
              <div className="card-foot"><div className="end">
                <button type="button" className="btn" disabled={busy} onClick={() => act("google.useForBand")} data-testid="google-use-for-band">Use my account</button>
              </div></div>
            )}
            {status.band && !status.band.isMe && <p className="s m-0">Changing it leaves shows already on the old calendar there; the next change to a show puts it on the new one.</p>}
          </section>
        </>
      )}
    </div>
  );
}
