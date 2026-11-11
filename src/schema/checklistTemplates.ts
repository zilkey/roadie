import { z } from "zod";
import { entity, serverMask, id } from "./common";

/** One to-do on a template: just its text (a list made from it gets new item ids, not done, unassigned). */
export const templateItem = z.strictObject({ id, label: z.string().min(1) });

/**
 * A named checklist an artist's admins keep (Artist settings › Checklist templates). On a show, "New list" copies one in;
 * changing a template never touches lists already on shows. `order` is the order of the "New list" buttons.
 */
export const ChecklistTemplate = entity({
  artistId: id,
  name: z.string().min(1),
  order: z.number().int(),
  items: z.array(templateItem),
});
export const ChecklistTemplateInput = ChecklistTemplate.omit(serverMask);
export type ChecklistTemplate = z.infer<typeof ChecklistTemplate>;
