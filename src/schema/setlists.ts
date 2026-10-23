import { z } from "zod";
import { entity, serverMask, id } from "./common";

export const SetlistItem = z.strictObject({
  type: z.enum(["song", "break"]),
  songId: id.optional(),
  title: z.string(),
  lengthSec: z.number().int().optional(),
  key: z.string().optional(),
  note: z.string().optional(),
});
export const Setlist = entity({
  name: z.string().min(1),
  showId: id.optional(),
  items: z.array(SetlistItem),
  totalSec: z.number().int(),
});
/** totalSec is computed by db.ts */
export const SetlistInput = Setlist.omit({ ...serverMask, totalSec: true });
export type Setlist = z.infer<typeof Setlist>;
