import { randomUUID } from "node:crypto";
import { DEFAULT_TEMPLATES } from "@/lib/shows";
import type { Writer } from "./db";

const newId = () => randomUUID().slice(0, 8);

/** Give an artist the starting checklist templates (Promo, Follow Up), after any it already has. Used by artists.create, scripts/seed.ts and migrate:checklists. */
export async function seedDefaultTemplates(w: Writer, artistId: string): Promise<string[]> {
  const have = await w.query("checklistTemplates", (q) => q.where("artistId", "==", artistId));
  let order = Math.max(-1, ...have.map((t) => t.order as number)) + 1;
  const ids: string[] = [];
  for (const t of DEFAULT_TEMPLATES) {
    ids.push((await w.create("checklistTemplates", { artistId, name: t.name, order: order++, items: t.items.map((label) => ({ id: newId(), label })) })).id);
  }
  return ids;
}
