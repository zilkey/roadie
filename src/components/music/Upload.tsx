"use client";
import { useRef, useState, type ReactNode } from "react";
import { ErrorBox } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { artistHeaders } from "@/lib/commands";
import { clientAuth } from "@/lib/firebase-client";

/** Cloud Run turns away requests over 32 MB; say so before uploading rather than after. */
const MAX_BYTES = 32 * 1024 * 1024;

interface UploadOpts<T> {
  url: string; tooBig: string;
  /** Refuse a file before it's sent: the reason, or null to go ahead. */
  check?(file: File): string | null;
  /** The route's answer after a good upload. */
  onUploaded?(json: T): void;
}

/** Send one file to `url` (multipart: `fields` plus `file`) with progress; the route answers with the Drive folder it landed in. */
function useUpload<T>({ url, tooBig, check, onUploaded }: UploadOpts<T>) {
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function upload(file: File, fields: Record<string, string>, reset: () => void) {
    setError(null); setDone(null);
    if (file.size > MAX_BYTES) { setError(`${file.name} is over 32 MB. ${tooBig}`); reset(); return; }
    const refused = check?.(file);
    if (refused) { setError(refused); reset(); return; }
    const user = clientAuth().currentUser;
    if (!user) { setError("Not signed in"); return; }
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.append(k, v);
    body.append("file", file);
    const token = await user.getIdToken();
    setPct(0);
    // XHR rather than fetch: fetch can't report upload progress, and a recording takes a while on a phone.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("authorization", `Bearer ${token}`);
    for (const [k, v] of Object.entries(artistHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setPct(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => { setPct(null); setError("You're offline"); };
    xhr.onload = () => {
      setPct(null);
      reset();
      let json: { error?: { message?: string }; folder?: { name: string } } = {};
      try { json = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) { setDone(`Uploaded to ${json.folder?.name ?? "Drive"}.`); onUploaded?.(json as T); }
      else setError(json.error?.message ?? (xhr.status === 413 ? "That file is too big to upload." : `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.send(body);
  }
  return { upload, pct, error, done };
}

/**
 * Pick a file and it uploads at once to `url` (multipart: `fields` plus `file`), with progress. The route answers with
 * the Drive folder it landed in. Off, with `needsFolder` saying why, until the folder it goes into is chosen.
 */
export function Upload<T = unknown>({ url, fields = {}, label, accept, testid, disabled, needsFolder, tooBig, check, onUploaded }: UploadOpts<T> & {
  fields?: Record<string, string>; label: string; accept: string; testid: string;
  disabled: boolean; needsFolder: ReactNode;
}) {
  const { upload, pct, error, done } = useUpload<T>({ url, tooBig, check, onUploaded });
  const input = useRef<HTMLInputElement>(null);
  const reset = () => { if (input.current) input.current.value = ""; };
  const busy = pct !== null;
  return (
    <div className="grid gap-2">
      <label className={`btn acc justify-self-start${disabled || busy ? " pointer-events-none opacity-50" : ""}`} data-testid={testid}>
        {busy ? `Uploading… ${pct}%` : label}
        <input ref={input} type="file" accept={accept} className="sr-only" disabled={disabled || busy} data-testid={`${testid}-input`}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, fields, reset); }} />
      </label>
      {disabled && <span className="s text-sm" data-testid={`${testid}-needs-folder`}>{needsFolder}</span>}
      {done && <span className="s text-sm" role="status" data-testid={`${testid}-done`}>{done}</span>}
      <ErrorBox error={error} />
    </div>
  );
}

export interface UploadChoice {
  key: string; label: string; accept: string; fields: Record<string, string>;
  /** Off until its folder is chosen: `needsFolder` says why under the button, `hint` on the menu item. */
  disabled: boolean; needsFolder: ReactNode; hint: string;
}

/**
 * One "Upload ▾" button with a choice per kind of file (a song's Demo, Chart). Picking one opens the file chooser for
 * that kind; the file uploads at once, like Upload. A choice whose folder isn't chosen yet stays in the menu, off, with
 * `needsFolder` under the button. Test ids: `${testid}-actions` (the button), `${testid}-menu-${key}`,
 * `${testid}-${key}-input` (each hidden file input), `${testid}-done`.
 */
export function UploadMenu<T = unknown>({ url, choices, testid, tooBig, check, onUploaded }: UploadOpts<T> & { choices: UploadChoice[]; testid: string }) {
  const { upload, pct, error, done } = useUpload<T>({ url, tooBig, check, onUploaded });
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const busy = pct !== null;
  const off = choices.filter((c) => c.disabled);
  return (
    <div className="grid gap-2">
      <Menu label="Upload" testid={testid} triggerClass={`btn acc${busy ? " pointer-events-none opacity-50" : ""}`} trigger={busy ? `Uploading… ${pct}%` : "Upload ▾"}
        items={choices.map((c) => ({ key: c.key, label: c.label, disabled: c.disabled || busy, hint: c.hint, onSelect: () => inputs.current[c.key]?.click() }))} />
      {choices.map((c) => (
        <input key={c.key} ref={(el) => { inputs.current[c.key] = el; }} type="file" accept={c.accept} className="sr-only" disabled={c.disabled || busy} data-testid={`${testid}-${c.key}-input`}
          onChange={(e) => { const el = e.target; const f = el.files?.[0]; if (f) void upload(f, c.fields, () => { el.value = ""; }); }} />
      ))}
      {off.map((c) => <span key={c.key} className="s text-sm" data-testid={`${testid}-${c.key}-needs-folder`}>{c.needsFolder}</span>)}
      {done && <span className="s text-sm" role="status" data-testid={`${testid}-done`}>{done}</span>}
      <ErrorBox error={error} />
    </div>
  );
}
