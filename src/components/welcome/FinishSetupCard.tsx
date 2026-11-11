"use client";
import { SetupRows, SETUP_ROWS } from "./SetupRows";
import { useSetupStatus } from "./useSetupStatus";
import { useArtist } from "@/lib/artist";
import { runCommand } from "@/lib/commands";

/** Home's "Finish setting up {band}" card (admins). It goes away once every row is done or the admin dismisses it. */
export function FinishSetupCard() {
  const { slug, name } = useArtist();
  const { status, setStatus } = useSetupStatus();
  if (!status || status.dismissed) return null;
  if (SETUP_ROWS.every((r) => status[r.id])) return null;
  const dismiss = () => {
    setStatus({ ...status, dismissed: true });
    runCommand("artists.dismissSetup").catch(() => setStatus(status));
  };
  return (
    <section className="card grid gap-3" data-testid="finish-setup">
      <div className="flex items-center justify-between gap-3">
        <h2 className="lbl m-0">Finish setting up {name}</h2>
        <button type="button" className="btn ghost" onClick={dismiss} data-testid="finish-setup-dismiss">Dismiss</button>
      </div>
      <SetupRows slug={slug} done={status} />
    </section>
  );
}
