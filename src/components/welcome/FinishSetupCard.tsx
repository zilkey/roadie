"use client";
import { useEffect, useState } from "react";
import { SetupRows, SETUP_ROWS } from "./SetupRows";
import { useArtist } from "@/lib/artist";
import { runCommand } from "@/lib/commands";

interface Status { people: boolean; links: boolean; google: boolean; dismissed: boolean }

/** Home's "Finish setting up {band}" card (admins). Rows without a built screen (import) are left out; it goes away once every shown row is done or the admin dismisses it. */
export function FinishSetupCard() {
  const { slug, name, artistId } = useArtist();
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let live = true;
    runCommand<Status>("artists.setupStatus").then((s) => { if (live) setStatus(s); }, () => {});
    return () => { live = false; };
  }, [artistId]);
  if (!status || status.dismissed) return null;
  const shown = SETUP_ROWS.filter((r) => r.href).map((r) => r.id);
  if (shown.every((id) => status[id as keyof Status])) return null;
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
      <SetupRows slug={slug} only={shown} done={status} />
    </section>
  );
}
