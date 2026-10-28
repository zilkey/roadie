"use client";
import { useEffect, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { CopyButton } from "@/components/booking/common";
import { runCommand } from "@/lib/commands";

export interface ShortcutStatus {
  installUrl: string | null;
  token: { createdAt: string; lastUsedAt: string | null } | null;
  endpoints: { rehearsals: string; songs: string; upload: string };
}
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Settings > Google: the "Send to Roadie" iOS Shortcut. Share a voice memo to it and it asks which rehearsal and
 * which songs (one memo can hold a run of them), then uploads through /api/rehearsals/{id}/recording with a shortcut token (rsk_…, shown once here).
 * The band builds the Shortcut once and saves its iCloud link here as the Install button; the recipe is under
 * "How to build it".
 */
export function ShortcutCard() {
  const { call, error, busy, setError } = useCommand();
  const [status, setStatus] = useState<ShortcutStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState(false);
  const [url, setUrl] = useState("");
  useEffect(() => { runCommand<ShortcutStatus>("shortcut.status", {}).then(setStatus, (e: Error) => setError(e.message)); }, [setError]);

  async function makeToken() {
    if (status?.token && !confirm("Make a new token? The Shortcut stops working until you put the new one in it.")) return;
    const r = await call<ShortcutStatus & { newToken: string }>("shortcut.createToken", {});
    if (r) { setToken(r.newToken); setStatus(r); }
  }
  async function revoke() {
    if (!confirm("Revoke your token? The Shortcut stops working until you make a new one.")) return;
    const r = await call<ShortcutStatus>("shortcut.revokeToken", {});
    if (r) { setToken(null); setStatus(r); }
  }
  async function saveUrl(e: React.FormEvent) {
    e.preventDefault();
    const r = await call<ShortcutStatus>("shortcut.setInstallUrl", { url: url.trim() || null });
    if (r) { setStatus(r); setEditUrl(false); setUrl(""); }
  }

  return (
    <section className={`card${editUrl ? " editing" : ""}`} data-testid="google-shortcut" aria-labelledby="google-shortcut-title">
      <div className="card-head">
        <h2 id="google-shortcut-title">Voice memo shortcut</h2>
        {status && !editUrl && <button type="button" className="card-edit" onClick={() => { setEditUrl(true); setUrl(status.installUrl ?? ""); setError(null); }} data-testid="shortcut-url-change">{status.installUrl ? "Change link" : "Add link"}</button>}
      </div>
      <p className="m-0">
        Record a song in Voice Memos, share it to <b>Send to Roadie</b>, pick the rehearsal and the songs on it (one or several, for a run of songs in one memo), and it lands in that rehearsal&apos;s Drive folder and on each song, like an upload from the app.
      </p>
      {!status ? <p className="s m-0" data-testid="shortcut-loading">Loading…</p> : (
        <>
          <div className="grid gap-1">
            <span className="lbl">1 · Your token</span>
            {token ? (
              <div className="grid gap-1" data-testid="shortcut-token-box">
                <div className="flex flex-wrap items-center gap-2"><code className="break-all rounded bg-soft px-2 py-1 text-sm" data-testid="shortcut-token">{token}</code><CopyButton text={token} /></div>
                <span className="s text-sm">Copy it now; it isn&apos;t shown again. The Shortcut asks for it when you install it.</span>
              </div>
            ) : status.token ? (
              <p className="m-0" data-testid="shortcut-token-status">You have a token, made {when(status.token.createdAt)}, {status.token.lastUsedAt ? `last used ${when(status.token.lastUsedAt)}` : "not used yet"}.</p>
            ) : <p className="m-0" data-testid="shortcut-token-status">No token yet. Make one, then put it in the Shortcut when you install it.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`btn ${status.token ? "ghost" : "acc"} sm`} disabled={busy} onClick={() => void makeToken()} data-testid="shortcut-make-token">{status.token ? "Make a new token" : "Make a token"}</button>
              {status.token && <button type="button" className="btn text sm" disabled={busy} onClick={() => void revoke()} data-testid="shortcut-revoke">Revoke</button>}
            </div>
          </div>
          <div className="grid gap-1">
            <span className="lbl">2 · Install the Shortcut on your phone</span>
            {status.installUrl
              ? <a className="btn acc justify-self-start" href={status.installUrl} target="_blank" rel="noreferrer" data-testid="shortcut-install">Install Send to Roadie</a>
              : <p className="m-0 s" data-testid="shortcut-no-url">No install link yet. Whoever builds the Shortcut (below) shares it as an iCloud link and adds it here.</p>}
          </div>
          {editUrl && (
            <form className="grid gap-2" onSubmit={saveUrl} data-testid="shortcut-url-form">
              <label htmlFor="shortcut-url" className="lbl">The Shortcut&apos;s iCloud link (Share › Copy iCloud Link); blank removes it</label>
              <div className="flex gap-2">
                <input id="shortcut-url" className="input" value={url} autoFocus placeholder="https://www.icloud.com/shortcuts/…" onChange={(e) => { setUrl(e.target.value); setError(null); }} data-testid="shortcut-url" />
                <button className="btn acc" disabled={busy} data-testid="shortcut-url-save">Save</button>
              </div>
              <div className="card-foot"><div className="end"><button type="button" className="btn text" onClick={() => { setEditUrl(false); setError(null); }} data-testid="shortcut-url-cancel">Cancel</button></div></div>
            </form>
          )}
          <ErrorBox error={error} />
          <details className="text-sm" data-testid="shortcut-recipe">
            <summary className="cursor-pointer font-semibold">How to build it (once, for the band)</summary>
            <ol className="mt-2 grid gap-1 pl-5">
              <li>In Shortcuts, make a new shortcut named <b>Send to Roadie</b>. In its details, turn on <b>Show in Share Sheet</b> and set the share sheet types to <b>Files</b> and <b>Media</b>.</li>
              <li><b>Text</b>: paste your token. When you share the Shortcut as an iCloud link, mark this Text as an import question (&ldquo;Your Roadie shortcut token&rdquo;) so each admin enters their own.</li>
              <li><b>Get Contents of URL</b>: <code className="break-all">{status.endpoints.rehearsals}</code>, method GET, header <code>Authorization</code> = <code>Bearer</code> + the Text.</li>
              <li><b>Get Dictionary Value</b> rehearsals → <b>Get Dictionary Value</b> labels → <b>Choose from List</b> (&ldquo;Which rehearsal?&rdquo;) → <b>Get Dictionary Value</b> the chosen item from rehearsals → ids. That is the rehearsal id.</li>
              <li><b>Get Contents of URL</b>: <code className="break-all">{status.endpoints.songs}</code> with the rehearsal id in place of <code>{"{rehearsalId}"}</code>, same header. Then songs → labels → <b>Choose from List</b> (&ldquo;Which songs?&rdquo;) with <b>Select Multiple</b> on → <b>Repeat with Each</b> chosen item: <b>Get Dictionary Value</b> the Repeat Item from songs → ids → <b>End Repeat</b> → <b>Combine Text</b> the Repeat Results with Commas. Those are the song ids.</li>
              <li><b>Get Contents of URL</b>: <code className="break-all">{status.endpoints.upload}</code> with the rehearsal id, method POST, same header, Request Body <b>Form</b>: <code>songIds</code> = the song ids, <code>file</code> = Shortcut Input (as a file).</li>
              <li><b>Show Notification</b>: &ldquo;Uploaded to&rdquo; + <b>Get Dictionary Value</b> folder → name. Share the Shortcut (Copy iCloud Link) and add the link above.</li>
            </ol>
          </details>
        </>
      )}
    </section>
  );
}
