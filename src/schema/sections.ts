import { z } from "zod";

/**
 * The main sections someone can tuck away into the nav's "More" group. Home is always there.
 * Per-user prefs, not business data: top-level `userPrefs/{uid}` = { hiddenSections: SectionId[], order: SectionId[] }, written with firebase-admin
 * directly (no history, not undoable), owner-only read by rules. A hidden section's routes still work when visited directly.
 */
export const SECTION_IDS = ["shows", "booking", "templates", "songs", "money"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const SectionIdSchema = z.enum(SECTION_IDS);
export const isSectionId = (s: unknown): s is SectionId => (SECTION_IDS as readonly unknown[]).includes(s);

export const SECTION_LABEL: Record<SectionId, string> = { booking: "Booking", templates: "Email templates", shows: "Shows", songs: "Songs", money: "Money" };
export const SectionSetInput = z.strictObject({ section: SectionIdSchema, hidden: z.boolean() });

/** The default left-to-right order of the sections after Home (also the order of SECTION_IDS). */
export const DEFAULT_SECTION_ORDER: readonly SectionId[] = SECTION_IDS;
/** A stored order made whole: unknown and repeated ids dropped, sections it doesn't mention appended in the default order. */
export function normalizeOrder(v: unknown): SectionId[] {
  const seen = (Array.isArray(v) ? v : []).filter(isSectionId).filter((s, i, a) => a.indexOf(s) === i);
  return [...seen, ...DEFAULT_SECTION_ORDER.filter((s) => !seen.includes(s))];
}
export const SectionOrderInput = z.strictObject({ order: z.array(SectionIdSchema).max(SECTION_IDS.length).refine((a) => new Set(a).size === a.length, "Each section once") });
