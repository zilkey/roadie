import { z } from "zod";
import { entity, serverMask, id } from "./common";

export const EmailTemplate = entity({
  /** The artist this record belongs to (tenancy phase 2: optional until the prod backfill). */
  artistId: id,
  name: z.string().min(1),
  subject: z.string(),
  body: z.string(),
  targetKinds: z.array(z.enum(["venue", "promoter", "edition"])),
});
export const EmailTemplateInput = EmailTemplate.omit(serverMask);
export type EmailTemplate = z.infer<typeof EmailTemplate>;
