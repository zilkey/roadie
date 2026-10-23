import { z } from "zod";
import { DraftSaveInput } from "@/schema/drafts";
import { discardDraft, listDrafts, saveDraft } from "../drafts";
import { defineCommand } from "./types";

const strict = <T extends z.ZodRawShape>(s: T) => z.strictObject(s);

export const draftsSave = defineCommand({
  name: "drafts.save", roles: ["admin", "member"], input: DraftSaveInput,
  description: "Save the caller's unfinished 'new X' form (one draft per kind + contextKey). Personal scratch space: no history, not undoable.",
  run: (ctx, i) => saveDraft(ctx.uid, i),
});
export const draftsDiscard = defineCommand({
  name: "drafts.discard", roles: ["admin", "member"], input: strict({ draftId: z.string().min(1).max(150) }),
  description: "Throw away one of the caller's drafts.",
  async run(ctx, i) { await discardDraft(ctx.uid, i.draftId); return { draftId: i.draftId }; },
});
export const draftsList = defineCommand({
  name: "drafts.list", roles: ["admin", "member"], input: strict({}),
  description: "The caller's drafts from the last 30 days, newest first.",
  async run(ctx) {
    return { drafts: (await listDrafts(ctx.uid)).map((d) => ({ id: d.id, kind: d.kind, contextKey: d.contextKey, title: d.title, route: d.route, values: d.values, updatedAt: d.updatedAt.toMillis() })) };
  },
});

export const draftCommands = [draftsSave, draftsDiscard, draftsList];
