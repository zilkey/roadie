"use client";
import { useState } from "react";
import { useAuth, useProfile } from "@/lib/auth";
import { useCommand } from "@/components/ui";

/**
 * Shown on a shared card (venue, act, promoter, festival) to someone who isn't approved to change shared records: asks Roadie's
 * platform admins (sharedEditors.request). Once asked it says so until they decide.
 */
export function AskToEdit({ testid = "ask-to-edit" }: { testid?: string }) {
  const { sharedEditRequested } = useProfile();
  const { refresh } = useAuth();
  const { call, busy, error } = useCommand();
  const [asked, setAsked] = useState(false);
  if (sharedEditRequested || asked) {
    return <span className="s" data-testid={`${testid}-asked`} title="Roadie's admins will let you know">Asked to edit</span>;
  }
  return (
    <button type="button" className="btn ghost sm" disabled={busy} data-testid={testid} title={error ?? "Only approved editors can change shared details. Ask Roadie's admins to approve you."}
      onClick={async () => { if (await call("sharedEditors.request", {})) { setAsked(true); void refresh(); } }}>
      Ask to edit
    </button>
  );
}
