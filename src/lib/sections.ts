"use client";
import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { useArtistRouter as useRouter } from "@/lib/artist";
import { clientDb } from "./firebase-client";
import { useAuth } from "./auth";
import { runCommand } from "./commands";
import { DEFAULT_HIDDEN, isSectionId, normalizeOrder, SECTION_LABEL, type SectionId } from "@/schema/sections";
import { toast } from "@/components/Toasts";

/** Live nav prefs of the signed-in user (userPrefs/{uid}; owner-only read): hidden sections (the defaults until the person stores their own) and their order. `loaded` is false until the first snapshot. */
export function useHiddenSections() {
  const { state } = useAuth();
  const uid = state.status === "ready" ? state.profile.uid : null;
  const [hidden, setHidden] = useState<SectionId[]>([...DEFAULT_HIDDEN]);
  const [order, setOrder] = useState<SectionId[]>(() => normalizeOrder([]));
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(doc(clientDb(), "userPrefs", uid), (s) => {
      const v = s.data()?.hiddenSections;
      setHidden(Array.isArray(v) ? v.filter(isSectionId) : [...DEFAULT_HIDDEN]); setOrder(normalizeOrder(s.data()?.order)); setLoaded(true);
    }, () => setLoaded(true));
  }, [uid]);
  return { hidden, order, loaded };
}
export const useNavPrefs = useHiddenSections;

/** Save the section order (command sections.setOrder). */
export const setSectionOrder = (order: SectionId[]) => runCommand("sections.setOrder", { order });

/** Hide or bring back a section (command sections.setHidden). */
export const setSectionHidden = (section: SectionId, hidden: boolean) => runCommand("sections.setHidden", { section, hidden });

/**
 * "I don't need this right now": hides the section from the main nav (it moves to More), says so in a toast and goes to the Calendar.
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
      router.push("/calendar");
    } catch (e) {
      toast({ key: `hide:${section}`, text: `Couldn't hide ${SECTION_LABEL[section]}: ${e instanceof Error ? e.message : "error"}`, ms: 6000 });
    } finally { setBusy(false); }
  }, [section, router]);
  return { run, busy };
}
