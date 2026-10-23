"use client";
import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { clientDb } from "./firebase-client";
import { useAuth } from "./auth";
import { runCommand } from "./commands";
import { isSectionId, SECTION_LABEL, type SectionId } from "@/schema/sections";
import { toast } from "@/components/Toasts";

/** Live set of the signed-in user's hidden sections (userPrefs/{uid}; owner-only read). `loaded` is false until the first snapshot. */
export function useHiddenSections() {
  const { state } = useAuth();
  const uid = state.status === "ready" ? state.profile.uid : null;
  const [hidden, setHidden] = useState<SectionId[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(clientDb(), "userPrefs", uid), (s) => {
      const v = s.data()?.hiddenSections;
      setHidden(Array.isArray(v) ? v.filter(isSectionId) : []); setLoaded(true);
    }, () => setLoaded(true));
  }, [uid]);
  return { hidden, loaded };
}

/** Hide or bring back a section (command sections.setHidden). */
export const setSectionHidden = (section: SectionId, hidden: boolean) => runCommand("sections.setHidden", { section, hidden });

/**
 * "I don't need this right now": hides the section from the main nav (it moves to More), says so in a toast and goes Home.
 *   const hide = useHideSection("booking");  <button onClick={hide.run} disabled={hide.busy}>
 */
export function useHideSection(section: SectionId) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    try {
      await setSectionHidden(section, true);
      toast({ key: `hide:${section}`, text: `${SECTION_LABEL[section]} is tucked away in More.`, ms: 5000 });
      router.push("/home");
    } catch (e) {
      toast({ key: `hide:${section}`, text: `Couldn't hide ${SECTION_LABEL[section]}: ${e instanceof Error ? e.message : "error"}`, ms: 6000 });
    } finally { setBusy(false); }
  }, [section, router]);
  return { run, busy };
}
