import { z } from "zod";
import { entity, serverMask, id, dateStr, sourcesShape } from "./common";

export const Edition = entity({
  festivalId: id,
  festivalName: z.string().min(1),
  year: z.number().int(),
  label: z.string().min(1),
  startDate: dateStr.optional(),
  endDate: dateStr.optional(),
  appOpens: z.strictObject({ date: dateStr, sure: z.enum(["confirmed", "estimated"]) }).optional(),
  appDeadline: z.strictObject({ date: dateStr, sure: z.enum(["confirmed", "estimated", "target"]) }).optional(),
  notifyDate: dateStr.optional(),
  applyUrl: z.string().optional(),
  venueIds: z.array(id),
  payNotes: z.string().optional(),
  notes: z.string().optional(),
  ...sourcesShape,
});
export const EditionInput = Edition.omit(serverMask);
export type Edition = z.infer<typeof Edition>;
