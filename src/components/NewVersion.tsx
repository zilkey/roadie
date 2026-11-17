"use client";
import { useNewVersion } from "@/lib/useNewVersion";

/** "Roadie was updated. Reload": shown at the top once a deploy has happened since this tab loaded. Unsaved edits are kept as drafts on the server, so reloading loses nothing. */
export function NewVersion() {
  const updated = useNewVersion();
  if (!updated) return null;
  return (
    <div role="status" data-testid="new-version"
      className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+8px)] z-40 mx-auto flex w-fit max-w-[calc(100%-16px)] items-center gap-3 rounded-full border border-border bg-surface py-1.5 pl-4 pr-1.5 shadow-lg">
      <span>Roadie was updated.</span>
      <button type="button" className="btn acc" data-testid="new-version-reload" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}
