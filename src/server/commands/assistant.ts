import { z } from "zod";
import { defineCommand } from "./types";
import { run } from "../db";
import { AppError } from "../errors";
import { AssistantPrefs } from "@/schema/assistant";
import type { Ctx } from "../ctx";

type Prefs = z.infer<typeof AssistantPrefs>;
const prefsOf = (u: Record<string, unknown>): Prefs => ((u.prefs as { assistant?: Prefs } | undefined)?.assistant) ?? {};

/**
 * The conversation the panel opens (null: none, after New chat), chosen at `at` (the person's tap, their device's
 * clock). Both the browser and the chat request set it, and either can land late: an older choice never undoes a newer.
 * Read and written in one transaction: the two often arrive together (New chat, then the first message), and a
 * read-then-write outside one let the older choice overwrite the newer it never saw.
 */
export async function setOpenThread(ctx: Ctx, threadId: string | null, at?: number): Promise<boolean> {
  return run(ctx, async (w) => {
    const u = await w.get("users", ctx.uid);
    if (!u || u.deletedAt) throw new AppError("not_found", "User not found", 404);
    const cur = prefsOf(u);
    if (at !== undefined && cur.threadAt !== undefined && cur.threadAt > at) return false;
    const next: Prefs = { ...cur, ...(at !== undefined ? { threadAt: at } : {}) };
    if (threadId === null) delete next.threadId; else next.threadId = threadId;
    return (await w.update("users", ctx.uid, { prefs: { assistant: next } })).changed;
  });
}

export const assistantSetPrefs = defineCommand({
  name: "assistant.setPrefs",
  roles: ["admin"],
  description: "Remember the caller's Roadie panel width and current conversation.",
  input: z.strictObject({ width: AssistantPrefs.shape.width, threadId: AssistantPrefs.shape.threadId.nullable(), at: AssistantPrefs.shape.threadAt }),
  async run(ctx, input) {
    let changed = false;
    if (input.width !== undefined) {
      // In a transaction too, so a width saved while a chat request records the conversation doesn't undo it.
      changed = await run(ctx, async (w) => {
        const u = await w.get("users", ctx.uid);
        if (!u || u.deletedAt) throw new AppError("not_found", "User not found", 404);
        return (await w.update("users", ctx.uid, { prefs: { assistant: { ...prefsOf(u), width: input.width } } })).changed;
      });
    }
    if (input.threadId !== undefined) changed = (await setOpenThread(ctx, input.threadId, input.at)) || changed;
    return { id: ctx.uid, changed };
  },
});

export const assistantCommands = [assistantSetPrefs];
