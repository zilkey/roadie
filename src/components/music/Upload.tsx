"use client";
import { useRef, useState, type ReactNode } from "react";
import { ErrorBox } from "@/components/ui";
import { artistHeaders } from "@/lib/commands";
import { clientAuth } from "@/lib/firebase-client";

/** Cloud Run turns away requests over 32 MB; say so before uploading rather than after. */
const MAX_BYTES = 32 * 1024 * 1024;

/**
 * Pick a file and it uploads at once to `url` (multipart: `fields` plus `file`), with progress. The route answers with
 * the Drive folder it landed in. Off, with `needsFolder` saying why, until the folder it goes into is chosen.
 */
export function Upload<T = unknown>({ url, fields = {}, label, accept, testid, disabled, needsFolder, tooBig, check, onUploaded }: {
  url: string; fields?: Record<string, string>; label: string; accept: string; testid: string;
  disabled: boolean; needsFolder: ReactNode; tooBig: string;
  /** Refuse a file before it's sent: the reason, or null to go ahead. */
  check?(file: File): string | null;
  /** The route's answer after a good upload. */
  onUploaded?(json: T): void;
}) {
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError(null); setDone(null);
    if (file.size > MAX_BYTES) { setError(`${file.name} is over 32 MB. ${tooBig}`); return; }
    const refused = check?.(file);
    if (refused) { setError(refused); if (input.current) input.current.value = ""; return; }
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
      if (input.current) input.current.value = "";
      let json: { error?: { message?: string }; folder?: { name: string } } = {};
      try { json = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) { setDone(`Uploaded to ${json.folder?.name ?? "Drive"}.`); onUploaded?.(json as T); }
      else setError(json.error?.message ?? (xhr.status === 413 ? "That file is too big to upload." : `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.send(body);
  }

  const busy = pct !== null;
  return (
    <div className="grid gap-2">
      <label className={`btn acc justify-self-start${disabled || busy ? " pointer-events-none opacity-50" : ""}`} data-testid={testid}>
        {busy ? `Uploading… ${pct}%` : label}
        <input ref={input} type="file" accept={accept} className="sr-only" disabled={disabled || busy} data-testid={`${testid}-input`}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      </label>
      {disabled && <span className="s text-sm" data-testid={`${testid}-needs-folder`}>{needsFolder}</span>}
      {done && <span className="s text-sm" role="status" data-testid={`${testid}-done`}>{done}</span>}
      <ErrorBox error={error} />
    </div>
  );
}
