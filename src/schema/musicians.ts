import { z } from "zod";
import { entity, serverMask, email, id } from "./common";

export const Musician = entity({
  name: z.string().min(1),
  instruments: z.array(z.string()),
  userId: id.optional(),
  email: email.optional(),
  phone: z.string().optional(),
  payHandle: z.string().optional(),
  active: z.boolean(),
});
export const MusicianInput = Musician.omit(serverMask);
export type Musician = z.infer<typeof Musician>;
