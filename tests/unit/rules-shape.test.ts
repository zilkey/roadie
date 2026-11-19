/**
 * The shape of firestore.rules (tenancy plan D6), checked without an emulator:
 * - every `match` of the rules D6 replaced still has a counterpart, so no collection the browser read before is silently closed;
 * - a collection-group wildcard (`{path=**}`) is used only for tracks and history (rules OR together, so a wildcard `comments`
 *   match would widen pitch comments to whoever reads show comments);
 * - the old global helpers (`isAdmin()`, `isMember()`, `band()`) and the single `musicianId` claim are gone: every check is per artist;
 * - every artist kind with a rule checks a role in an artist, never just "signed in".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OWNERS, movesUnderArtist, ownerOf } from "@/schema/owners";

const rules = readFileSync("firestore.rules", "utf8").replace(/\/\/.*$/gm, "");

/** Every match as its collection chain: "shows", "shows/comments", "**\/history". */
function matches(src: string): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  let depth = 0;
  const opens: number[] = [];
  const re = /match\s+\/(\S+)\s+\{|\{|\}/g;
  for (let m; (m = re.exec(src)); ) {
    if (m[1] !== undefined) {
      const segs = m[1].split("/").map((s) => (s === "{path=**}" ? "**" : s)).filter((s) => s && !/^\{[^}]*\}$/.test(s));
      stack.push(segs.join("/"));
      opens.push(depth++);
      if (segs[0] !== "databases") out.push(stack.slice(1).filter(Boolean).join("/"));
    } else if (m[0] === "{") depth++;
    else {
      depth--;
      if (opens.length && opens[opens.length - 1] === depth) { opens.pop(); stack.pop(); }
    }
  }
  return out;
}

/** The matches of the rules phase 6 replaced (main at ac12ffa). */
const OLD = [
  "users", "fuelPrices", "unsubmittedDrafts", "userPrefs", "musicians", "venues", "venueTypes", "venueNotes", "venueEvents",
  "venueEventSources", "venueEventNotes", "acts", "actNotes", "checklistTemplates", "artists", "shows", "shows/comments", "songs", "files",
  "releases", "**/tracks", "setlistTemplates", "setlists", "rehearsals", "tours", "tours/entries", "posts", "socialChecklists", "todos",
  "stagePlots", "availability", "expenses", "projects", "income", "payouts", "contacts", "promoters", "festivals", "editions",
  "festivalNotes", "editionNotes", "promoterNotes", "contactNotes", "emailTemplates", "emailThreads", "showDeals", "statSnapshots",
  "mcpTokens", "fans", "**/history", "assistantThreads", "assistantThreads/messages", "pitches", "pitches/comments", "pitches/activity",
  "campaigns",
];

test("the parser finds the rules' matches", () => {
  const found = matches(rules);
  assert.ok(found.includes("shows/comments") && found.includes("**/history") && found.includes("assistantThreads/messages"), found.join(", "));
});

test("every match of the replaced rules has a counterpart", () => {
  const found = new Set(matches(rules));
  assert.deepEqual(OLD.filter((m) => !found.has(m)), []);
});

test("collection-group wildcards only for tracks and history", () => {
  assert.deepEqual(matches(rules).filter((m) => m.includes("**")).sort(), ["**/history", "**/tracks"]);
});

test("no global role helpers or the single musicianId claim remain", () => {
  for (const old of [/\bisAdmin\(\)/, /\bisMember\(\)/, /\bband\(\)/, /token\.get\('musicianId'/]) assert.doesNotMatch(rules, old);
});

test("every artist kind's rule checks a role in an artist", () => {
  // Each match line's own condition (one-line rules) or the block that follows (multi-line ones).
  for (const m of matches(rules)) {
    const kind = m.split("/").pop()!;
    if (ownerOf(kind) !== "artist") continue;
    const at = rules.search(new RegExp(`match\\s+\\/(?:\\{path=\\*\\*\\}\\/)?${kind}\\/`));
    const body = rules.slice(at, rules.indexOf("allow", at) + 400).split(/\n\s*match\s/)[0];
    assert.match(body, /\b(admin|inArtist|member)\(/, `${m} must check a role in an artist`);
  }
});

test("phase 10: every artist kind that moves has a path-based rule under artists/{a}, and the ones that stay top level don't", () => {
  const found = new Set(matches(rules));
  const moving = Object.keys(OWNERS).filter(movesUnderArtist);
  // Kinds the browser never reads have no rule in either layout (server only).
  const readByBrowser = moving.filter((k) => found.has(k));
  assert.deepEqual(readByBrowser.filter((k) => !found.has(`artists/${k}`)), []);
  for (const sub of ["shows/comments", "tours/entries", "pitches/comments", "pitches/activity", "releases/tracks"]) assert.ok(found.has(`artists/${sub}`), sub);
  for (const top of ["mcpTokens", "assistantThreads", "invites", "shortcutTokens"]) assert.ok(!found.has(`artists/${top}`), top);
  // Nested rules check the role in the artist the path names ({a}), never the record's own field.
  const nested = rules.slice(rules.indexOf("match /artists/{a}"), rules.indexOf("match /socialChecklists/{id}  { allow read: if admin(id)"));
  assert.doesNotMatch(nested, /\bA\(\)/);
});
