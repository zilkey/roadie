import { z } from "zod";

/**
 * The main sections someone can tuck away into the nav's "More" group. Home is always there.
 * Per-user prefs, not business data: top-level `userPrefs/{uid}` = { hiddenSections: SectionId[] }, written with firebase-admin
 * directly (no history, not undoable), owner-only read by rules. A hidden section's routes still work when visited directly.
 */
export const SECTION_IDS = ["booking", "shows", "songs", "money"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const SectionIdSchema = z.enum(SECTION_IDS);
export const isSectionId = (s: unknown): s is SectionId => (SECTION_IDS as readonly unknown[]).includes(s);

export const SECTION_LABEL: Record<SectionId, string> = { booking: "Booking", shows: "Shows", songs: "Songs", money: "Money" };
export const SectionSetInput = z.strictObject({ section: SectionIdSchema, hidden: z.boolean() });
