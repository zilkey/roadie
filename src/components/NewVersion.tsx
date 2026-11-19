"use client";
import { useAuth } from "@/lib/auth";
import { useNewVersion, useReadOnly } from "@/lib/useNewVersion";

/** "Roadie was updated. Reload": shown at the top once a deploy has happened since this tab loaded. Unsaved edits are kept as drafts on the server, so reloading loses nothing. */
export function NewVersion() {
  const updated = useNewVersion();
  return (
    <>
      <ReadOnlyBanner />
      {updated && (
        <div role="status" data-testid="new-version"
          className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+8px)] z-40 mx-auto flex w-fit max-w-[calc(100%-16px)] items-center gap-3 rounded-full border border-border bg-surface py-1.5 pl-4 pr-1.5 shadow-lg">
          <span>Roadie was updated.</span>
          <button type="button" className="btn acc" data-testid="new-version-reload" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}
    </>
  );
}

/** Tenancy phase 10's few minutes while data moves: every change is refused with the same words, so say it up front. */
function ReadOnlyBanner() {
  const { state } = useAuth();
  const readOnly = useReadOnly(state.status === "ready" && state.profile.readOnly === true);
  if (!readOnly) return null;
  return (
    <div role="status" data-testid="read-only"
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+8px)] z-40 mx-auto w-fit max-w-[calc(100%-16px)] rounded-full border border-border bg-surface px-4 py-1.5 shadow-lg">
      Roadie is moving your data. Changes are paused for a few minutes.
    </div>
  );
}
