"use client";
import { useEffect, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { CopyButton } from "@/components/booking/common";
import { runCommand } from "@/lib/commands";
import { SHORTCUT_PATH, SHORTCUT_VERSION } from "@/lib/shortcut-file";

export interface ShortcutStatus {
  installUrl: string | null;
  token: { createdAt: string; lastUsedAt: string | null } | null;
  endpoints: { now: string; rehearsals: string; songs: string; upload: string };
}
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Settings > Google: the "Send to Roadie" iOS Shortcut. Share a voice memo to it and it asks which rehearsal and
 * which songs (one memo can hold a run of them), then uploads through /api/rehearsals/{id}/recording with a shortcut token (rsk_…, shown once here).
 * The Shortcut itself ships with the app (public/shortcuts, built by `npm run shortcut:build` from src/lib/shortcut-file.ts):
 * Download Send to Roadie installs it, asking for the token on the way. A hand-built one's iCloud link can be kept here
 * too; the recipe under "What the Shortcut does" is what both do.
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
        Record a song in Voice Memos, share it to <b>Send to Roadie</b>, pick the songs (one or several, for a run of songs in one memo) and the rehearsal, unless one is on right now, and it lands in that rehearsal&apos;s Drive folder and on each song, like an upload from the app. A notification says what happened: uploaded, or why not.
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
            <div className="flex flex-wrap items-center gap-2">
              <a className="btn acc" href={`${SHORTCUT_PATH}?v=${SHORTCUT_VERSION}`} download="Send to Roadie.shortcut" data-testid="shortcut-download">Download Send to Roadie</a>
              {status.installUrl && <a className="btn ghost" href={status.installUrl} target="_blank" rel="noreferrer" data-testid="shortcut-install">Install from iCloud</a>}
            </div>
            <p className="m-0 s text-sm">Open the downloaded file on your phone: Shortcuts asks for your token (step 1) and adds it. Download it again whenever this page says a newer version is out (this is version {SHORTCUT_VERSION}); an old one keeps working until the recipe changes.</p>
            {!status.installUrl && <p className="m-0 s text-sm" data-testid="shortcut-no-url">If the band keeps a hand-built copy, add its iCloud link with Add link.</p>}
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
            <summary className="cursor-pointer font-semibold">What the Shortcut does (to build one by hand)</summary>
            <ol className="mt-2 grid gap-1 pl-5">
              <li>A shortcut named <b>Send to Roadie</b> with <b>Show in Share Sheet</b> on, share sheet types <b>Files</b> and <b>Media</b>.</li>
              <li><b>Text</b>: your token. When sharing the Shortcut, mark this Text as an import question (&ldquo;Your Roadie shortcut token&rdquo;) so each admin enters their own.</li>
              <li><b>Get Contents of URL</b>: <code className="break-all">{status.endpoints.now}</code>, method GET, header <code>Authorization</code> = <code>Bearer</code> + the Text. If a rehearsal is on (today, between its start and end time) the answer has a <code>rehearsal</code>; otherwise it has the <code>rehearsals</code> list (the older <code className="break-all">{status.endpoints.rehearsals}</code> still answers the list alone). Every answer with an <code>error</code> also has a <code>message</code>: <b>If</b> error has any value → <b>Show Notification</b> message → <b>Stop This Shortcut</b>.</li>
              <li><b>If</b> the answer has a value for <code>rehearsal</code>: <b>Get Dictionary Value</b> rehearsal → id is the rehearsal id and the answer's <code>songs</code> are the songs list (skip the next step). <b>Otherwise</b>: <b>Get Dictionary Value</b> rehearsals → <b>Get Dictionary Value</b> labels → <b>Choose from List</b> (&ldquo;Which rehearsal?&rdquo;) → <b>Get Dictionary Value</b> the chosen item from rehearsals → ids. That is the rehearsal id.</li>
              <li>Only when you chose the rehearsal yourself: <b>Get Contents of URL</b>: <code className="break-all">{status.endpoints.songs}</code> with the rehearsal id in place of <code>{"{rehearsalId}"}</code>, same header, same error check. Then songs → labels → <b>Choose from List</b> (&ldquo;Which songs?&rdquo;) with <b>Select Multiple</b> on → <b>Repeat with Each</b> chosen item: <b>Get Dictionary Value</b> the Repeat Item from songs → ids → <b>End Repeat</b> → <b>Combine Text</b> the Repeat Results with Commas. Those are the song ids.</li>
              <li><b>Get Contents of URL</b>: <code className="break-all">{status.endpoints.upload}</code> with the rehearsal id, method POST, same header, Request Body <b>Form</b>: <code>songIds</code> = the song ids (Text), <code>file</code> = Shortcut Input as a <b>File</b> field. A Text field here sends the memo's name instead of the memo, and the upload answers &ldquo;No recording came through&rdquo;.</li>
              <li><b>Get Dictionary Value</b> message → <b>Show Notification</b>. The message is &ldquo;Uploaded … to …&rdquo; or &ldquo;Upload failed: …&rdquo;, so a failure never looks like a success.</li>
            </ol>
          </details>
        </>
      )}
    </section>
  );
}
