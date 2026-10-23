import { z } from "zod";
import { entity, serverMask } from "./common";

export const ChecklistTemplate = entity({
  label: z.string().min(1),
  when: z.enum(["always", "bandSound", "venueSound", "poster", "backline", "merch"]),
  daysBefore: z.number().int(),
});
export const ChecklistTemplateInput = ChecklistTemplate.omit(serverMask);
export type ChecklistTemplate = z.infer<typeof ChecklistTemplate>;
