import { z } from "zod";
import { entity, serverMask, id, dateStr } from "./common";

export const Rehearsal = entity({
  date: dateStr,
  place: z.string().optional(),
  personnel: z.array(id),
  songs: z.array(z.strictObject({ songId: id, title: z.string(), note: z.string().optional() })),
  notes: z.string().optional(),
});
export const RehearsalInput = Rehearsal.omit(serverMask);
export type Rehearsal = z.infer<typeof Rehearsal>;
