import { z } from "zod";
import { entity, serverMask, id, ts } from "./common";

/** Doc id is the sha256 hash of the token. */
export const McpToken = entity({
  userId: id,
  label: z.string().min(1),
  lastUsedAt: ts.optional(),
  revokedAt: ts.optional(),
});
export const McpTokenInput = McpToken.omit(serverMask);
export type McpToken = z.infer<typeof McpToken>;
