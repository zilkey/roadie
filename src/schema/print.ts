import { z } from "zod";

/**
 * How someone last printed a setlist, per artist. Per-user prefs, not business data: `userPrefs/{uid}.print[artistId]`,
 * written with firebase-admin like the other prefs (no history, no undo).
 * `fields` holds extra-field ids: "key", "length", "breaks", or "field:<songFieldId>" for one of the artist's song fields.
 */
export const PrintOptions = z.strictObject({
  copy: z.enum(["band", "mine"]),
  sheets: z.enum(["one", "perSet"]),
  fields: z.array(z.string().min(1)),
  titles: z.enum(["wrap", "short"]),
  header: z.boolean(),
  /** Set lengths count the song-to-song transitions (the show's transitionSec; 30s on a template). Missing = true (saved before this existed). */
  transitions: z.boolean().optional(),
  paper: z.enum(["letter", "a4"]),
});
export type PrintOptions = z.infer<typeof PrintOptions>;
export type PrintCopy = PrintOptions["copy"];
export type PrintPaper = PrintOptions["paper"];
