import { z } from "zod";
import { entity, serverMask, id } from "./common";

export const EmailTemplate = entity({
  /** The artist this record belongs to (tenancy phase 2: optional until the prod backfill). */
  artistId: id,
  name: z.string().min(1),
  subject: z.string(),
  /** The message as plain text, with {{fields}}. Kept in step with `html` when that is set. */
  body: z.string(),
  /** The message with its formatting (bold, italic, underline, links, lists) as sanitized HTML; set by the app's editor. Leave it out to write plain text in `body`. */
  html: z.string().optional(),
  targetKinds: z.array(z.enum(["venue", "promoter", "edition"])),
});
export const EmailTemplateInput = EmailTemplate.omit(serverMask);
export type EmailTemplate = z.infer<typeof EmailTemplate>;
