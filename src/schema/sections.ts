import { z } from "zod";

/**
 * The main sections someone can tuck away into the nav's "More" group. Calendar is always first and is not part of it.
 * Per-user prefs, not business data: top-level `userPrefs/{uid}` = { hiddenSections: SectionId[], order: SectionId[] }, written with firebase-admin
 * directly (no history, not undoable), owner-only read by rules. A hidden section's routes still work when visited directly.
 */
export const SECTION_IDS = ["shows", "booking", "templates", "songs", "releases", "setlists", "rehearsals", "stagePlots", "money", "fans"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const SectionIdSchema = z.enum(SECTION_IDS);
export const isSectionId = (s: unknown): s is SectionId => (SECTION_IDS as readonly unknown[]).includes(s);
/** A stored section id, with the old name of a renamed section mapped to its new one ("albums" became "releases"). */
export const legacySectionId = (s: unknown): unknown => (s === "albums" ? "releases" : s);

export const SECTION_LABEL: Record<SectionId, string> = { booking: "Booking", templates: "Email templates", shows: "Shows", songs: "Songs", releases: "Releases", setlists: "Setlist Templates", rehearsals: "Rehearsals", stagePlots: "Stage plots", money: "Money", fans: "Fans" };
export const SectionSetInput = z.strictObject({ section: SectionIdSchema, hidden: z.boolean() });

/**
 * Sections that start life in "More": what a person gets until they first change their menu. Once `hiddenSections` is stored (even as an empty list)
 * it is theirs as saved, so switching one of these on stores an explicit pref.
 */
export const DEFAULT_HIDDEN: readonly SectionId[] = ["templates", "releases", "setlists", "rehearsals", "stagePlots"];
/** A member's defaults: Rehearsals stays in the main nav and My money starts in More. */
export const MEMBER_DEFAULT_HIDDEN: readonly SectionId[] = ["templates", "setlists", "stagePlots", "money"];
export const defaultHidden = (role: string): SectionId[] => [...(role === "member" ? MEMBER_DEFAULT_HIDDEN : DEFAULT_HIDDEN)];

/** The default left-to-right order of the sections (also the order of SECTION_IDS). */
export const DEFAULT_SECTION_ORDER: readonly SectionId[] = SECTION_IDS;
/** A stored order made whole: unknown and repeated ids dropped, sections it doesn't mention appended in the default order. */
export function normalizeOrder(v: unknown): SectionId[] {
  const seen = (Array.isArray(v) ? v : []).map(legacySectionId).filter(isSectionId).filter((s, i, a) => a.indexOf(s) === i);
  return [...seen, ...DEFAULT_SECTION_ORDER.filter((s) => !seen.includes(s))];
}
export const SectionOrderInput = z.strictObject({ order: z.array(SectionIdSchema).max(SECTION_IDS.length).refine((a) => new Set(a).size === a.length, "Each section once") });
