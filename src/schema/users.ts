import { z } from "zod";
import { AssistantPrefs } from "./assistant";
import { entity, serverMask, email, id } from "./common";

export const User = entity({
  email,
  name: z.string().min(1),
  role: z.enum(["admin", "member"]),
  musicianId: id.optional(),
  mcpAccess: z.boolean(),
  prefs: z.strictObject({ assistant: AssistantPrefs.optional() }).optional(),
});
export const UserInput = User.omit(serverMask);
export type User = z.infer<typeof User>;
