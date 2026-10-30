/** Per-user prefs at userPrefs/{uid}. Written with firebase-admin directly (like drafts): personal, so no history entry and no undo. */
import { hiddenFromPrefs, normalizeOrder, SECTION_IDS, type SectionId } from "@/schema/sections";
import { PrintOptions } from "@/schema/print";
import { firestore } from "./admin";

const ref = (uid: string) => firestore().collection("userPrefs").doc(uid);

/** The caller's hidden sections; their role's defaults until they have stored a list of their own (an empty list is their own), plus sections added since (hiddenFromPrefs). */
export async function hiddenSections(uid: string, role: string): Promise<SectionId[]> {
  return hiddenFromPrefs((await ref(uid).get()).data(), role);
}

export async function setSectionHidden(uid: string, role: string, section: SectionId, hidden: boolean): Promise<SectionId[]> {
  const cur = await hiddenSections(uid, role);
  const next = hidden ? [...new Set([...cur, section])] : cur.filter((s) => s !== section);
  await ref(uid).set({ uid, hiddenSections: next, seenSections: [...SECTION_IDS] }, { merge: true });
  return next;
}

export async function sectionOrder(uid: string): Promise<SectionId[]> {
  return normalizeOrder((await ref(uid).get()).data()?.order);
}

/** Saves the caller's section order ; sections left out keep their default place at the end. */
export async function setSectionOrder(uid: string, order: SectionId[]): Promise<SectionId[]> {
  const next = normalizeOrder(order);
  await ref(uid).set({ uid, order: next }, { merge: true });
  return next;
}

export type AskChannel = "email" | "signal";

/** How the caller last asked who's free in this artist (Email or Signal); the Ask form starts there. */
export async function setAskChannel(uid: string, artistId: string, channel: AskChannel): Promise<void> {
  await ref(uid).set({ uid, askChannel: { [artistId]: channel } }, { merge: true });
}

/** How the caller last printed a setlist in this artist; null when they never did (or the stored value no longer validates). */
export async function printPrefs(uid: string, artistId: string): Promise<PrintOptions | null> {
  const p = PrintOptions.safeParse((await ref(uid).get()).data()?.print?.[artistId]);
  return p.success ? p.data : null;
}

export async function setPrintPrefs(uid: string, artistId: string, o: PrintOptions): Promise<void> {
  await ref(uid).set({ uid, print: { [artistId]: o } }, { merge: true });
}

/** Whether the caller dismissed the "Finish setting up" card on Home for this artist. */
export async function setupDismissed(uid: string, artistId: string): Promise<boolean> {
  return (await ref(uid).get()).data()?.setupDismissed?.[artistId] === true;
}

export async function dismissSetup(uid: string, artistId: string): Promise<void> {
  await ref(uid).set({ uid, setupDismissed: { [artistId]: true } }, { merge: true });
}

/** Whether the caller shows the Tours layer on the Calendar (default off). */
export async function calendarTours(uid: string): Promise<boolean> {
  return (await ref(uid).get()).data()?.calendarTours === true;
}

export async function setCalendarTours(uid: string, on: boolean): Promise<void> {
  await ref(uid).set({ uid, calendarTours: on }, { merge: true });
}
