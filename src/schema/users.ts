import { z } from "zod";
import { entity, serverMask, email, id } from "./common";

export const User = entity({
  email,
  name: z.string().min(1),
  role: z.enum(["admin", "member"]),
  musicianId: id.optional(),
  mcpAccess: z.boolean(),
});
export const UserInput = User.omit(serverMask);
export type User = z.infer<typeof User>;
