import { z } from "zod";
import { entity, serverMask, id } from "./common";

/**
 * todos/{id}: one item on To Dos › Our list, the band's own to-dos not tied to any show, release or post. Admins only (for now).
 * ownerId is a musician (missing = unassigned); doneAt/doneBy are stamped by todos.check.
 */
export const Todo = entity({
  artistId: id,
  label: z.string().trim().min(1),
  done: z.boolean().default(false),
  ownerId: id.optional(),
  doneAt: z.string().optional(),
  doneBy: z.string().optional(),
  /** Pinned to To Dos › Pinned (shared by every admin), like a checklist item's pin. */
  pinnedAt: z.string().optional(),
  pinnedBy: z.string().optional(),
});
export const TodoInput = Todo.omit(serverMask);
export type Todo = z.infer<typeof Todo>;

