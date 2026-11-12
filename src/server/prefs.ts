/** Per-user prefs at userPrefs/{uid}. Written with firebase-admin directly (like drafts): personal, so no history entry and no undo. */
import { hiddenFromPrefs, normalizeOrder, SECTION_IDS, type SectionId } from "@/schema/sections";
import { PrintOptions } from "@/schema/print";
import { pruneDismissed } from "@/lib/dayOf";
import { dateInBandZone } from "@/lib/timezone";
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

/** The day-of banner rows (#66) the caller hid in this artist: keys "{kind}:{id}:{date}" (dayOfKey). */
export async function dayOfDismissed(uid: string, artistId: string): Promise<string[]> {
  const v = (await ref(uid).get()).data()?.dayOfDismissed?.[artistId];
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : [];
}

/** Hides one row of the day-of banner for the caller. Keys older than a week are dropped on the way: their day is over. */
export async function dismissDayOf(uid: string, artistId: string, key: string): Promise<string[]> {
  const next = [...new Set([...pruneDismissed(await dayOfDismissed(uid, artistId), dateInBandZone()), key])];
  await ref(uid).set({ uid, dayOfDismissed: { [artistId]: next } }, { merge: true });
  return next;
}

/**
 * When the caller last opened Booking's Venue calendars in this artist (#79, the "New" chips): stores now and returns the time
 * stored before, null on their first look.
 */
export async function lookAtCalendars(uid: string, artistId: string, now: string): Promise<string | null> {
  const prev = (await ref(uid).get()).data()?.calendarsLookedAt?.[artistId];
  await ref(uid).set({ uid, calendarsLookedAt: { [artistId]: now } }, { merge: true });
  return typeof prev === "string" ? prev : null;
}

/** To Dos (#todos): the caller's own order of each column (column key -> item keys, top first), of the columns themselves (left first), and the checklists they dismissed. */
export interface TodoPrefs { order: Record<string, string[]>; columns: string[]; dismissed: string[] }
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : []);
export async function todoPrefs(uid: string): Promise<TodoPrefs> {
  const d = (await ref(uid).get()).data();
  const o = (d?.todoOrder ?? {}) as Record<string, unknown>;
  return { order: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, strings(v)])), columns: strings(d?.todoColumns), dismissed: strings(d?.todoDismissed) };
}
/** Saves one column's order for the caller; other columns and other people's are untouched. */
export async function setTodoOrder(uid: string, column: string, keys: string[]): Promise<string[]> {
  const next = [...new Set(keys)];
  await ref(uid).set({ uid, todoOrder: { [column]: next } }, { merge: true });
  return next;
}
/** Saves the caller's order of the columns themselves (left first); columns not listed go after, in their usual order. */
export async function setTodoColumns(uid: string, keys: string[]): Promise<string[]> {
  const next = [...new Set(keys)];
  await ref(uid).set({ uid, todoColumns: next }, { merge: true });
  return next;
}
/** Dismisses (or, with on=false, brings back) one checklist on the caller's To Dos. */
export async function setTodoDismissed(uid: string, key: string, on: boolean): Promise<string[]> {
  const cur = (await todoPrefs(uid)).dismissed;
  const next = on ? [...new Set([...cur, key])] : cur.filter((k) => k !== key);
  await ref(uid).set({ uid, todoDismissed: next }, { merge: true });
  return next;
}
