import { z } from "zod";
import { entity, serverMask, id } from "./common";

/** A song the band might play instead of the one it's pinned to. A copy like the item's own; it never counts toward the set's time. */
export const SetlistAlt = z.strictObject({
  songId: id,
  title: z.string(),
  key: z.string().optional(),
});
export const SetlistItem = z.strictObject({
  type: z.enum(["song", "break"]),
  songId: id.optional(),
  title: z.string(),
  lengthSec: z.number().int().optional(),
  key: z.string().optional(),
  note: z.string().optional(),
  /** Song items only: alternates pinned to this song, in the order they were added. They move with it. */
  alts: z.array(SetlistAlt).optional(),
  /** Song items only: what the band does to get into this song from the item above it (the "Show transitions" notes). It lives on the lower song, so it moves with it. */
  transitionNote: z.string().optional(),
});
/** Reusable list: setlistTemplates/{autoId}. Song items are references; no show link. */
export const SetlistTemplate = entity({
  /** The artist this record belongs to (tenancy phase 2: optional until the prod backfill). */
  artistId: id,
  name: z.string().min(1),
  items: z.array(SetlistItem),
  totalSec: z.number().int(),
});
/** Where a show's setlist was seeded from; name is a display copy at seed time. Later edits to either side never touch the other. */
export const SetlistSource = z.strictObject({
  kind: z.enum(["template", "show"]),
  id,
  name: z.string().optional(),
});
/** A show's actual setlist: setlists/{showId}, the document id IS the show id. Items carry copies. */
export const Setlist = entity({
  /** The artist this record belongs to (tenancy phase 2: optional until the prod backfill). */
  artistId: id,
  items: z.array(SetlistItem),
  totalSec: z.number().int(),
  source: SetlistSource.optional(),
});
/** totalSec is computed by db.ts: songs + breaks only. Transitions are added where it is shown (setlistTotal, the show's transitionSec). */
export const SetlistTemplateInput = SetlistTemplate.omit({ ...serverMask, totalSec: true });
export const SetlistInput = Setlist.omit({ ...serverMask, totalSec: true });
export type SetlistTemplate = z.infer<typeof SetlistTemplate>;
export type Setlist = z.infer<typeof Setlist>;
