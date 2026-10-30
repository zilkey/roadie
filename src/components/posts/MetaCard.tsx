"use client";
import { useEffect, useRef, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { runCommand } from "@/lib/commands";
import { fmtInstant } from "@/lib/timezone";

export interface PageChoice { pageId: string; pageName: string; igId: string; igUsername: string }
export interface MetaStatus {
  configured: boolean;
  connection: { page: { id: string; name: string }; instagram: { id: string; username: string }; connectedBy: { uid: string; name: string }; connectedAt: string } | null;
  /** Asked of Instagram each time the card opens. */
  check: { working: true; username: string } | { working: false; reason: string } | null;
  choose: PageChoice[] | null;
}

/** What Facebook's error_reason (or error) means, when the dialog comes back without a code. */
const cancelled = (why: string) => why === "user_denied" || why === "access_denied"
  ? "Facebook wasn't connected: the sign-in was cancelled."
  : `Facebook wasn't connected: ${why}.`;

/**
 * Settings › Integrations › Instagram & Facebook (admins): the band's Facebook Page and its Instagram, connected once with
 * Facebook Login. Facebook's dialog comes back through /api/meta/callback to this page with ?meta_code&meta_state, which
 * finishes here as the signed-in admin. "Working" is a live check each time the card opens.
 */
export function MetaCard() {
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const { call, error, busy, setError } = useCommand();
  const [note, setNote] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    const code = q.get("meta_code"), state = q.get("meta_state"), denied = q.get("meta_error");
    if (code || denied) window.history.replaceState(null, "", window.location.pathname);
    if (denied) setError(cancelled(denied));
    const load = code && state ? runCommand<MetaStatus>("meta.finishConnect", { code, state }) : runCommand<MetaStatus>("meta.status", {});
    load.then((s) => { setStatus(s); if (code && s.connection && !s.choose) setNote("Connected."); },
      (e: Error) => { setError(e.message); runCommand<MetaStatus>("meta.status", {}).then(setStatus, () => undefined); });
  }, [setError]);

  async function connect() {
    const r = await call<{ url: string }>("meta.connectUrl", {});
    if (r) window.location.assign(r.url);
  }
  async function act(name: "meta.disconnect" | "meta.cancelChoice" | "meta.choosePage", input: object = {}) {
    setNote(null);
    const s = await call<MetaStatus>(name, input);
    if (!s) return;
    setStatus(s);
    if (name === "meta.choosePage") setNote("Connected.");
  }

  const c = status?.connection, check = status?.check;
  return (
    <section className="card" data-testid="meta-card" aria-labelledby="meta-title">
      <div className="card-head">
        <h2 id="meta-title">Instagram &amp; Facebook</h2>
        {c && check && (check.working
          ? <span className="chip g" data-testid="meta-working">Working</span>
          : <span className="chip y" data-testid="meta-sign-in-again">Sign in again</span>)}
      </div>
      {!status ? <p className="s m-0" data-testid="meta-loading">Loading…</p>
        : !status.configured ? (
          <p className="m-0" data-testid="meta-not-configured">Not set up on this server. Posting to Instagram needs a Meta app (<code>META_APP_ID</code>; see docs/SETUP.md).</p>
        ) : status.choose ? (
          <div className="grid gap-2" data-testid="meta-choose">
            <p className="m-0">Facebook gave Roadie more than one Page with an Instagram. Which one is the band&apos;s?</p>
            {status.choose.map((p) => (
              <div key={p.pageId} className="flex items-center gap-2 rounded-lg border border-line p-2" data-testid={`meta-page-${p.pageId}`}>
                <span className="grid min-w-0 flex-1"><b className="truncate text-sm">@{p.igUsername}</b><span className="s">{p.pageName}</span></span>
                <button type="button" className="btn acc sm" disabled={busy} onClick={() => void act("meta.choosePage", { pageId: p.pageId })} data-testid="meta-choose-page">Choose</button>
              </div>
            ))}
          </div>
        ) : c ? (
          <div className="grid gap-1" data-testid="meta-connected">
            <p className="m-0"><b data-testid="meta-account">@{c.instagram.username}</b> · {check?.working ? "Working" : "Sign in again"}</p>
            <p className="s m-0" data-testid="meta-page">Facebook Page: {c.page.name}</p>
            <p className="s m-0" data-testid="meta-by">Connected by {c.connectedBy.name} on {fmtInstant(c.connectedAt, { month: "short", day: "numeric" })}</p>
            {check && !check.working && <p className="err m-0" data-testid="meta-reason">Instagram stopped answering: {check.reason} Connect again to fix it.</p>}
          </div>
        ) : (
          <p className="m-0" data-testid="meta-none">Not connected. Connect the band&apos;s Facebook Page and the Instagram linked to it, so admins can post from Roadie. The person connecting needs full control of the Page.</p>
        )}
      {note && <p className="s m-0" role="status" data-testid="meta-note">{note}</p>}
      <ErrorBox error={error} />
      {status?.configured && (
        <div className="card-foot"><div className="end">
          {status.choose
            ? <button type="button" className="btn text" disabled={busy} onClick={() => void act("meta.cancelChoice")} data-testid="meta-cancel">Cancel</button>
            : <>
              {c && <button type="button" className="btn text" disabled={busy}
                onClick={() => confirm(`Disconnect @${c.instagram.username}? Admins can't post from Roadie until someone connects again.`) && void act("meta.disconnect")} data-testid="meta-disconnect">Disconnect</button>}
              {(!c || !check?.working) && <button type="button" className="btn acc" disabled={busy} onClick={() => void connect()} data-testid="meta-connect">
                {c ? "Connect again" : "Connect with Facebook"}</button>}
            </>}
        </div></div>
      )}
    </section>
  );
}
