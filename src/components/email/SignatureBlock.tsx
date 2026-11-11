"use client";
import { useEffect, useState } from "react";
import Link from "@/lib/artist";
import { runCommand } from "@/lib/commands";
import { ROUTES } from "@/lib/routes";
import { sanitizeHtml } from "@/lib/email-html";

export const GMAIL_SIGNATURE_SETTINGS = "https://mail.google.com/mail/u/0/#settings/general";

export interface SignatureState {
  /** "loading" until email.signature answers; "unavailable" when Gmail can't give it (not connected, or the grant can't read settings); "error" when the call failed. */
  status: "loading" | "ready" | "unavailable" | "error";
  /** The signature as sanitized HTML ("" when none is set in Gmail). */
  html: string;
  /** Whether the person has it ticked for this mail. */
  include: boolean;
  setInclude(v: boolean): void;
  /** What the composer appends: the signature HTML when there is one and it is ticked, else null. */
  signatureHtml: string | null;
}

/** Fetches the Gmail signature once (email.signature) and keeps it, with the include tick, in component state. */
export function useSignature(): SignatureState {
  const [status, setStatus] = useState<SignatureState["status"]>("loading");
  const [html, setHtml] = useState("");
  const [include, setInclude] = useState(true);
  useEffect(() => {
    let live = true;
    runCommand<{ html: string; text: string } | null>("email.signature", {}).then(
      (r) => { if (!live) return; if (r) { setHtml(r.html); setStatus("ready"); } else setStatus("unavailable"); },
      () => { if (live) setStatus("error"); },
    );
    return () => { live = false; };
  }, []);
  return { status, html, include, setInclude, signatureHtml: status === "ready" && include && html ? html : null };
}

const ChangeLink = () => <a className="s" href={GMAIL_SIGNATURE_SETTINGS} target="_blank" rel="noopener noreferrer" data-testid="signature-change">Change it in Gmail ↗</a>;

/** The dashed box under the editor: the Gmail signature on the left, the "Signature from Gmail" tick on the right. */
export function SignatureBlock({ signature }: { signature: SignatureState }) {
  if (signature.status === "loading") return null;
  if (signature.status === "error") return <div className="sig-box" data-testid="signature-block"><div className="sig-body s">Couldn't load your Gmail signature.</div></div>;
  if (signature.status === "unavailable") {
    return (
      <div className="sig-box" data-testid="signature-block">
        <div className="sig-body s">Connect Gmail again to use your signature. <Link href={ROUTES.google.path} data-testid="signature-connect">Settings › Google</Link></div>
      </div>
    );
  }
  return (
    <div className="sig-box" data-testid="signature-block">
      {signature.html
        ? <div className={`sig-body${signature.include ? "" : " off"}`} data-testid="signature-html" dangerouslySetInnerHTML={{ __html: sanitizeHtml(signature.html) }} />
        : <div className="sig-body s">No signature set in Gmail.</div>}
      <div className="sig-side">
        {signature.html && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={signature.include} onChange={(e) => signature.setInclude(e.target.checked)} data-testid="signature-include" />Signature from Gmail</label>
        )}
        <ChangeLink />
      </div>
    </div>
  );
}
