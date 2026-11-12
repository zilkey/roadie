import { z } from "zod";
import { entity, serverMask, id } from "./common";

/** One to-do on a template: just its text (a list made from it gets new item ids, not done, unassigned). */
export const templateItem = z.strictObject({ id, label: z.string().min(1) });

/** What a checklist hangs off: a show, a release, or the band's Social Media sidebar (one per artist). */
export const checklistKind = z.enum(["show", "release", "social"]);
export type ChecklistKind = z.infer<typeof checklistKind>;

/**
 * A named checklist an artist's admins keep (Artist settings › Checklist templates). "New list" on a show, a release or the
 * Social Media sidebar copies one in (only templates that apply to that kind); changing a template never touches lists already
 * made from it. `order` is the order of the "New list" choices. appliesTo missing = "show" (templates made before releases had lists).
 */
export const ChecklistTemplate = entity({
  artistId: id,
  name: z.string().min(1),
  appliesTo: checklistKind.optional(),
  order: z.number().int(),
  items: z.array(templateItem),
});
export const ChecklistTemplateInput = ChecklistTemplate.omit(serverMask);
export type ChecklistTemplate = z.infer<typeof ChecklistTemplate>;
