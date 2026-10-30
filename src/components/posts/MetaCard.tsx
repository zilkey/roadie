"use client";
import { useEffect, useRef, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { runCommand } from "@/lib/commands";
import { fmtInstant } from "@/lib/timezone";

export interface MetaStatus {
  configured: boolean;
  connection: {
    kind: "system" | "instagram";
    instagram: { id: string; username: string };
    /** Roadie renews the sign-in; else it lasts until expiresAt (null: never). */
    renews: boolean;
    expiresAt: string | null;
    connectedBy: { uid: string; name: string };
    connectedAt: string;
  } | null;
  /** Asked of Instagram each time the card opens (renewing the sign-in first when it's due). */
  check: { working: true; username: string } | { working: false; reason: string } | null;
}

/** What Meta's error_reason (or error) means, when the dialog comes back without a code. */
const cancelled = (why: string) => why === "user_denied" || why === "access_denied"
  ? "Instagram wasn't connected: the sign-in was cancelled."
  : `Instagram wasn't connected: ${why}.`;

/** How long the sign-in lasts: renewed by Roadie, never expiring, or good until a date. */
const lifetime = (c: NonNullable<MetaStatus["connection"]>) => c.renews ? "Roadie renews it"
  : !c.expiresAt ? "Doesn't expire"
  : `Good until ${fmtInstant(c.expiresAt, { month: "short", day: "numeric", year: "numeric" })}; connect again before then`;

/**
 * Settings › Integrations › Instagram & Facebook (admins): the band's Instagram, connected once with Meta's Unified login
 * (log in with Instagram or Facebook, pick the band's business portfolio and Instagram). Meta's dialog comes back through
 * /api/meta/callback to this page with ?meta_code&meta_state, which finishes here as the signed-in admin. "Working" is a
 * live check each time the card opens.
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
    load.then((s) => { setStatus(s); if (code && s.connection) setNote("Connected."); },
      (e: Error) => { setError(e.message); runCommand<MetaStatus>("meta.status", {}).then(setStatus, () => undefined); });
  }, [setError]);

  async function connect() {
    const r = await call<{ url: string }>("meta.connectUrl", {});
    if (r) window.location.assign(r.url);
  }
  async function disconnect() {
    setNote(null);
    const s = await call<MetaStatus>("meta.disconnect", {});
    if (s) setStatus(s);
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
        ) : c ? (
          <div className="grid gap-1" data-testid="meta-connected">
            <p className="m-0"><b data-testid="meta-account">@{c.instagram.username}</b> · {check?.working ? "Working" : "Sign in again"}</p>
            <p className="s m-0" data-testid="meta-lifetime">{lifetime(c)}</p>
            <p className="s m-0" data-testid="meta-by">Connected by {c.connectedBy.name} on {fmtInstant(c.connectedAt, { month: "short", day: "numeric" })}</p>
            {check && !check.working && <p className="err m-0" data-testid="meta-reason">Instagram stopped answering: {check.reason} Connect again to fix it.</p>}
          </div>
        ) : (
          <p className="m-0" data-testid="meta-none">Not connected. Connect the band&apos;s Instagram, so admins can post from Roadie. Log in with Instagram or Facebook, then pick the band&apos;s business portfolio and its Instagram (a Business or Creator account).</p>
        )}
      {note && <p className="s m-0" role="status" data-testid="meta-note">{note}</p>}
      <ErrorBox error={error} />
      {status?.configured && (
        <div className="card-foot"><div className="end">
          {c && <button type="button" className="btn text" disabled={busy}
            onClick={() => confirm(`Disconnect @${c.instagram.username}? Admins can't post from Roadie until someone connects again.`) && void disconnect()} data-testid="meta-disconnect">Disconnect</button>}
          {(!c || !check?.working) && <button type="button" className="btn acc" disabled={busy} onClick={() => void connect()} data-testid="meta-connect">
            {c ? "Connect again" : "Connect Instagram"}</button>}
        </div></div>
      )}
    </section>
  );
}
