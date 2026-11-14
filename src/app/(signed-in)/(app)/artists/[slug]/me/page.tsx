"use client";
import { useEffect, useRef, useState } from "react";
import { useProfile } from "@/lib/auth";
import { useDoc } from "@/lib/firestore-hooks";
import { runCommand } from "@/lib/commands";
import type { SaveState } from "@/lib/autosave";
import { ErrorBox, PageTitle } from "@/components/ui";
import { SaveStatus } from "@/components/SaveStatus";
import { DrivingFields, DrivingValues, carsChanged, draftsToCars, homeLabel, mergeSaved, toDrafts, type CarDraft, type DrivingPatch } from "@/components/people/DrivingFields";
import type { DrivingSettings, User } from "@/schema";

const NOTE = "Admins in your band can see and edit this too. Gas expenses use it to work out miles and cost.";

export default function MySettingsPage() {
  const { uid } = useProfile();
  // users/{uid}: the signed-in person reads their own (firestore.rules). Writes go through me.updateDriving.
  const { doc, loading, error } = useDoc<User>("users", uid);
  return (
    <div className="grid gap-5">
      <PageTitle title="My settings" />
      <ErrorBox error={error ?? null} />
      {loading ? null : <Driving saved={doc?.driving} />}
    </div>
  );
}

/** Home address and cars: read-only until Edit (or open when nothing is set). Each change saves itself; Done closes the card. */
function Driving({ saved }: { saved?: DrivingSettings }) {
  const empty = !saved?.home && !saved?.cars?.length;
  const [editing, setEditing] = useState(empty);
  const [status, setStatus] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [homeText, setHomeText] = useState(homeLabel(saved?.home));
  const [rows, setRows] = useState<CarDraft[]>(() => toDrafts(saved?.cars));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const savedRef = useRef(saved); savedRef.current = saved;

  // Follow the live document (another device, or the save that just went out) without disturbing what is being typed.
  useEffect(() => { setRows((r) => mergeSaved(r, saved?.cars)); }, [saved?.cars]);
  const savedHome = homeLabel(saved?.home);
  useEffect(() => { setHomeText(savedHome); }, [savedHome]);

  async function save(patch: DrivingPatch) {
    setStatus("saving"); setError(null);
    try {
      await runCommand("me.updateDriving", patch);
      setStatus("saved");
    } catch (e) {
      setStatus(e instanceof Error && (e as { code?: string }).code === "offline" ? "offline" : "error");
      setError(e instanceof Error ? e.message : "error");
    }
  }
  function commitCars(next: CarDraft[]) {
    const { cars, errors: errs } = draftsToCars(next);
    setErrors(errs);
    if (Object.keys(errs).length || !carsChanged(savedRef.current?.cars, cars)) return;
    void save({ cars });
  }

  return (
    <section className={`card${editing ? " editing" : ""}`} data-testid="me-driving-card" aria-labelledby="driving-title">
      <div className="card-head">
        <div>
          <h2 id="driving-title" className="text-lg font-bold">Driving &amp; gas</h2>
          {!editing && <p className="s">Used to fill in gas expenses for rehearsals and shows.</p>}
        </div>
        {editing ? <span className="tag">Editing</span>
          : <button type="button" className="card-edit" onClick={() => { setError(null); setEditing(true); }} data-testid="me-edit">Edit</button>}
      </div>

      {editing ? (
        <div className="grid gap-4" data-testid="me-form">
          {empty && (
            <div className="grid gap-2 rounded-[14px] bg-accent-soft p-4">
              <p className="font-bold">Make gas expenses one tap</p>
              <p className="s">Add your home address and your car&apos;s MPG once. After that, logging gas for a rehearsal or show fills itself in. Drive more than one car? Add each; you pick one when you log gas.</p>
            </div>
          )}
          <DrivingFields testid="me" homeText={homeText} homeHint={NOTE} rows={rows} setRows={setRows} errors={errors} onCommit={commitCars}
            onPickHome={(h) => { setHomeText(homeLabel(h)); void save({ home: h }); }}
            onHomeText={(t) => { setHomeText(t); if (!t.trim() && savedRef.current?.home) void save({ home: null }); }} />
          <ErrorBox error={error} />
          <div className="card-foot"><div className="end">
            <SaveStatus status={status} error={error} />
            <button type="button" className="btn acc" data-testid="me-done" onClick={() => { commitCars(rows); setEditing(false); }}>Done</button>
          </div></div>
        </div>
      ) : (
        <div className="grid gap-3">
          <DrivingValues saved={saved} testid="me" />
          <span className="s">{NOTE}</span>
        </div>
      )}
    </section>
  );
}
