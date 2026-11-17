import { z } from "zod";
import { entity, serverMask, email, id } from "./common";

/**
 * invites/{id}: a pending membership for someone who already belongs to another artist (tenancy plan Q2, D2). It becomes a
 * membership only when they accept; declining or the admin withdrawing deletes it. One live invite per artist and email.
 * Added in phase 2, unused until phase 4.
 */
export const Invite = entity({
  artistId: id,
  email,
  name: z.string().min(1),
  role: z.enum(["admin", "member"]),
  mcpAccess: z.boolean().optional(),
  /** A musician record in the inviting artist: a new one with these instruments, or an existing one to link. */
  musician: z.union([z.strictObject({ instruments: z.array(z.string()) }), z.strictObject({ musicianId: id })]).optional(),
  invitedBy: id,
});
export const InviteInput = Invite.omit(serverMask);
export type Invite = z.infer<typeof Invite>;
