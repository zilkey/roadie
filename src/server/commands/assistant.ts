import { z } from "zod";
import { defineCommand } from "./types";
import { db } from "../db";
import { AppError } from "../errors";
import { AssistantPrefs } from "@/schema/assistant";

export const assistantSetPrefs = defineCommand({
  name: "assistant.setPrefs",
  roles: ["admin"],
  description: "Remember the caller's Roadie panel width and current conversation.",
  input: z.strictObject({ width: AssistantPrefs.shape.width, threadId: AssistantPrefs.shape.threadId.nullable() }),
  async run(ctx, input) {
    const u = await db.get("users", ctx.uid);
    if (!u || u.deletedAt) throw new AppError("not_found", "User not found", 404);
    const cur = ((u.prefs as { assistant?: z.infer<typeof AssistantPrefs> } | undefined)?.assistant) ?? {};
    const next = { ...cur, ...(input.width ? { width: input.width } : {}) };
    if (input.threadId === null) delete next.threadId;
    else if (input.threadId) next.threadId = input.threadId;
    const res = await db.update(ctx, "users", ctx.uid, { prefs: { assistant: next } });
    return { id: ctx.uid, changed: res.changed };
  },
});

export const assistantCommands = [assistantSetPrefs];
