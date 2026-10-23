import { z } from "zod";
import { entity, serverMask } from "./common";

export const EmailTemplate = entity({
  name: z.string().min(1),
  subject: z.string(),
  body: z.string(),
  targetKinds: z.array(z.enum(["venue", "promoter", "edition"])),
});
export const EmailTemplateInput = EmailTemplate.omit(serverMask);
export type EmailTemplate = z.infer<typeof EmailTemplate>;
