import { z } from "zod";
import { DraftPath, DraftSaveInput } from "@/schema/drafts";
import { clearDraft, listDrafts, saveDraft } from "../drafts";
import { defineCommand } from "./types";

export const draftsSave = defineCommand({
  name: "drafts.save", roles: ["admin", "member"], input: DraftSaveInput,
  description: "Save what the caller has typed but not submitted, keyed by the Firestore path of the form (last write wins). Personal scratch space: no history, not undoable.",
  run: (ctx, i) => saveDraft(ctx.uid, i),
});
export const draftsClear = defineCommand({
  name: "drafts.clear", roles: ["admin", "member"], input: z.strictObject({ path: DraftPath }),
  description: "Throw away the caller's unsubmitted draft at this path.",
  async run(ctx, i) { await clearDraft(ctx.uid, i.path); return { path: i.path }; },
});
export const draftsList = defineCommand({
  name: "drafts.list", roles: ["admin", "member"], input: z.strictObject({}),
  description: "The caller's unsubmitted drafts (30-day expiry), newest first.",
  async run(ctx) {
    return { drafts: (await listDrafts(ctx.uid)).map((d) => ({ path: d.path, title: d.title, route: d.route, values: d.values, updatedAt: d.updatedAt.toMillis() })) };
  },
});

export const draftCommands = [draftsSave, draftsClear, draftsList];
