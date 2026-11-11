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
  ...sourcesShape,
});
/** What db.ts validates for `editions`: the shared record. */
export const EditionRecord = Edition.omit(serverMask);
/** What the edition commands accept: the shared fields plus this band's payNotes and notes, which go to its editionNotes (src/schema/bandNotes.ts). */
export const EditionInput = EditionRecord.extend({ payNotes: z.string().optional(), notes: z.string().optional() });
export type Edition = z.infer<typeof Edition>;
