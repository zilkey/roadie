import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ownerOf } from "@/schema/owners";
import { clientQueries, serves, type Field } from "../../scripts/list-ranged-queries";

// Tenancy plan D5: the browser asks Firestore only for its artist. Every query goes through the hooks in src/lib/firestore-hooks.ts,
// which scope artist kinds by `artistId` and users lists by `artistIds` (src/lib/client-scope.ts). These checks keep it that way:
// no other Firestore list query in the browser, gets by a hand-written path only for a person's own docs, every hook kind known,
// and every browser query that orders, ranges or filters an array has its composite index (the emulator never says so).

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const BROWSER = files("src").map((f) => relative(".", f)).filter((f) => !f.startsWith("src/server/") && !f.startsWith("src/app/api/"));
const read = (f: string) => readFileSync(f, "utf8");
const lineOf = (s: string, i: number) => s.slice(0, i).split("\n").length;
const HOOKS = "src/lib/firestore-hooks.ts";
/** Files that use the client SDK (firebase/firestore), not firebase-admin. */
const clientSdk = BROWSER.filter((f) => /from "firebase\/firestore"/.test(read(f)));

/**
 * The browser's own Firestore list queries outside the hooks: each is keyed by a person's uid, or names no artist data. File → the
 * `collection(…)` arguments allowed there.
 */
const OWN_LISTS: Record<string, RegExp[]> = {
  "src/lib/drafts.ts": [/^clientDb\(\), "unsubmittedDrafts"$/], // where uid == me
  "src/components/roadie/useRoadie.ts": [
    /^clientDb\(\), pathOf\("messages", \{ parent: \{ kind: "assistantThreads", id: \w+ \} \}\)$/, // one thread's transcript (rules: its owner)
    /^clientDb\(\), pathOf\("assistantThreads", \{ artistId \}\)$/, // only to pick a new id, never read
  ],
};

test("the browser lists Firestore only through the hooks (or a person's own docs)", () => {
  const bad: string[] = [];
  for (const f of clientSdk) {
    if (f === HOOKS) continue;
    const s = read(f);
    for (const m of s.matchAll(/\bcollectionGroup\(/g)) bad.push(`${f}:${lineOf(s, m.index!)} collectionGroup`);
    for (const m of s.matchAll(/\bcollection\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
      const args = m[1].trim();
      if (!(OWN_LISTS[f] ?? []).some((r) => r.test(args))) bad.push(`${f}:${lineOf(s, m.index!)} collection(${args})`);
    }
  }
  assert.deepEqual(bad, [], "use useCollection/useDocs (they scope by artist), or add a list keyed by the person's uid to OWN_LISTS");
});

test("a get by a hand-written path is only for a person's own docs", () => {
  const bad: string[] = [];
  for (const f of clientSdk) {
    if (f === HOOKS) continue;
    const s = read(f);
    for (const m of s.matchAll(/\bdoc\(\s*clientDb\(\)\s*,\s*"(\w+)"/g)) {
      if (ownerOf(m[1]) !== "user") bad.push(`${f}:${lineOf(s, m.index!)} ${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], "read artist records with useDoc (its path comes from pathOf)");
});

test("every kind a hook is asked for has an owner", () => {
  const bad: string[] = [];
  for (const f of BROWSER) {
    if (f === HOOKS) continue;
    const s = read(f);
    for (const m of s.matchAll(/\buse(?:Collection|Doc|Docs|ArrayContainsAny)(?:<[^()]*?>)?\(\s*(?:"(\w+)"|`[^`/]*\/\$\{[^}]*\}\/(\w+)`)/g)) {
      const kind = m[1] ?? m[2];
      if (!ownerOf(kind)) bad.push(`${f}:${lineOf(s, m.index!)} ${kind}`);
    }
  }
  assert.deepEqual(bad, [], "add the kind to OWNERS (src/schema/owners.ts)");
});

const ix = JSON.parse(read("firestore.indexes.json")) as { indexes: { collectionGroup: string; queryScope: string; fields: Field[] }[] };

test("every ranged browser query on an artist kind or users has its composite index", () => {
  const missing = clientQueries().queries.flatMap((q) => (q.index && !ix.indexes.some((i) => serves(i, q.index!))
    ? [`${q.index.collectionGroup} (${q.index.queryScope}) ${q.index.fields.map((f) => `${f.fieldPath} ${f.order ?? f.arrayConfig}`).join(", ")} for ${q.at}`] : []));
  assert.deepEqual(missing, [], "add these to firestore.indexes.json (npx tsx scripts/list-ranged-queries.ts lists them)");
});

/** Browser queries whose kind or filters sit in a variable, by file, and why they need no index. */
const KNOWN_UNREAD: Record<string, string> = {
  "src/components/CustomFieldsEditor.tsx": "songs or shows, no filters",
  "src/components/booking/PersonalTouches.tsx": "`mine` is artistId ==: equality only",
  "src/components/money/MoneyCards.tsx": "whereOf(context) is one equality",
  "src/components/money/MoneyOutModal.tsx": "a release's tracks, no filters",
  "src/components/shows/page/NetCard.tsx": "showId ==: equality only",
};

test("every browser query the scanner can't read is accounted for", () => {
  const left = [...new Set(clientQueries().unread.map((at) => at.split(":")[0]))].filter((f) => !KNOWN_UNREAD[f]);
  assert.deepEqual(left, [], "say why each needs no index (KNOWN_UNREAD), or add one");
});
