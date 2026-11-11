/**
 * Linking venue-calendar bills to shared acts (issue #77). Each bill name that is an act (src/lib/acts.ts cleanActName) gets the
 * `actId` of the act with its matchKey; one not seen before becomes a new act, so the Acts list grows as calendars refresh. Names
 * that aren't acts ("Open Mic Night", "& More!") and the band's own name stay unlinked. Used by refresh and the prod backfill.
 */
import { actKey, type Act } from "@/schema";
import { cleanActName } from "@/lib/acts";
import { db, run } from "../db";
import { importCtx, type Ctx } from "../ctx";

const IN_LIMIT = 30;
/** Creates per write unit: each is the doc plus its history entry, well under a transaction's 500 writes. */
const CREATE_CHUNK = 100;

export interface LinkResult { linked: number; created: number; dropped: Map<string, string> }

/** The acts with these matchKeys, by key (the first live one when there are duplicates). */
export async function actsByKey(keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(keys)];
  for (let i = 0; i < uniq.length; i += IN_LIMIT) {
    for (const a of await db.list("acts", (q) => q.where("matchKey", "in", uniq.slice(i, i + IN_LIMIT)))) {
      if (!out.has(a.matchKey as string)) out.set(a.matchKey as string, a.id);
    }
  }
  return out;
}

/** Keys that are a band on Roadie itself: a tenant isn't an act on its own Acts list. */
async function ownKeys(): Promise<Set<string>> {
  const names = (await db.list("artists")).map((a) => String(a.name ?? "")); // "Ingrid Avison Band" is billed as "Ingrid Avison" too
  return new Set(names.flatMap((n) => [actKey(n), actKey(n.replace(/\s+band$/i, ""))]).filter(Boolean));
}

/**
 * Set `actId` on every act in these bills and `actIds` on each, creating acts for new names (unless `create` is false).
 * Changes the drafts in place.
 */
export async function linkActs<E extends { acts: Act[]; actIds?: string[] }>(events: E[], opts: { create?: boolean; ctx?: Ctx } = {}): Promise<LinkResult> {
  const dropped = new Map<string, string>();
  const named = new Map<string, string>(); // key -> clean name (first seen)
  const keyOf = new Map<string, string>(); // raw name -> key
  const own = await ownKeys();
  for (const e of events) for (const a of e.acts) {
    if (keyOf.has(a.name) || dropped.has(a.name)) continue;
    const c = cleanActName(a.name);
    if ("drop" in c) { dropped.set(a.name, c.drop); continue; }
    if (own.has(c.key)) { dropped.set(a.name, "this band"); continue; }
    keyOf.set(a.name, c.key);
    if (!named.has(c.key)) named.set(c.key, c.name);
  }
  const ids = await actsByKey([...named.keys()]);
  const missing = [...named].filter(([k]) => !ids.has(k));
  let created = 0;
  if (opts.create !== false && missing.length) {
    const ctx = opts.ctx ?? importCtx("venue-calendars");
    for (let i = 0; i < missing.length; i += CREATE_CHUNK) {
      await run(ctx, async (w) => {
        for (const [key, name] of missing.slice(i, i + CREATE_CHUNK)) {
          const r = await w.create("acts", { name });
          ids.set(key, r.id);
          if (!r.merged) created++;
        }
      });
    }
  }
  let linked = 0;
  for (const e of events) {
    const actIds: string[] = [];
    e.acts = e.acts.map((a) => {
      const { actId: _old, ...rest } = a;
      const id = ids.get(keyOf.get(a.name) ?? "");
      if (!id) return rest;
      if (!actIds.includes(id)) actIds.push(id);
      return { ...rest, actId: id };
    });
    if (actIds.length) { e.actIds = actIds; linked++; } else delete e.actIds;
  }
  return { linked, created, dropped };
}
