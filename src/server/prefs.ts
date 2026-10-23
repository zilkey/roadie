/** Per-user prefs at userPrefs/{uid}. Written with firebase-admin directly (like drafts): personal, so no history entry and no undo. */
import { isSectionId, type SectionId } from "@/schema/sections";
import { firestore } from "./admin";

const ref = (uid: string) => firestore().collection("userPrefs").doc(uid);

export async function hiddenSections(uid: string): Promise<SectionId[]> {
  const v = (await ref(uid).get()).data()?.hiddenSections;
  return Array.isArray(v) ? v.filter(isSectionId) : [];
}

export async function setSectionHidden(uid: string, section: SectionId, hidden: boolean): Promise<SectionId[]> {
  const cur = await hiddenSections(uid);
  const next = hidden ? [...new Set([...cur, section])] : cur.filter((s) => s !== section);
  await ref(uid).set({ uid, hiddenSections: next }, { merge: true });
  return next;
}
