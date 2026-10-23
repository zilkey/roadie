"use client";
import { useEffect, useRef, useState } from "react";
import { CommandError, newMutationId, runCommandFull } from "@/lib/commands";
import { toast, UNDO_MS } from "@/components/Toasts";
import { SaveStatus, type SaveStatusProps } from "@/components/SaveStatus";
import type { SaveState } from "@/lib/autosave";

/**
 * Whole-value commands (shows.setChecklist, shows.setGear, shows.packGear) that take the new list instead of a
 * `{id, patch}` pair can't go through useAutosave. Each change is one request, one history entry, one "Saved ... Undo"
 * toast, with a status next to the panel. The request is sent with keepalive, so closing the tab right after a change doesn't drop it
 * (offline, the change is not kept: the status says so and the list shows the live value). Not folded (`autosave` is off), so every Undo reverts exactly one change.
 */
export function useInstantSave() {
  const [status, setStatus] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  async function save(command: string, input: { id: string } & Record<string, unknown>, what: string): Promise<boolean> {
    setStatus("saving"); setError(null);
    try {
      const out = await runCommandFull(command, input, { clientMutationId: newMutationId() });
      toast({ key: `${command}:${input.id}:${out.runId}`, text: `Saved ${what}`, undoRunId: out.runId, ms: UNDO_MS });
      setStatus("saved");
      return true;
    } catch (e) {
      const ce = e as CommandError;
      setError(ce.message ?? "error"); setStatus(ce.code === "offline" ? "offline" : "error");
      return false;
    }
  }
  return { save, status, error };
}

/**
 * A panel's own save status. Only shown while something is happening (and for a few seconds after), so the page's main
 * `save-status` (the show form) stays the only one most of the time.
 */
export function PanelStatus(props: SaveStatusProps) {
  const { status } = props;
  const [fresh, setFresh] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (status === "saved") { setFresh(true); timer.current = setTimeout(() => setFresh(false), 4000); }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [status]);
  if (status === "idle" || (status === "saved" && !fresh)) return null;
  return <SaveStatus {...props} />;
}
