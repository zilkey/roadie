/**
 * The server queries on artist kinds that need a composite index once db.ts adds `where("artistId", "==", …)` to them (tenancy plan
 * D7): every query that combines that filter with an orderBy, a range, `in`, `not-in` or an array filter. Equality-only queries
 * merge single-field indexes and need nothing. The emulator doesn't enforce composite indexes, so tests/unit/indexes.test.ts runs
 * this and fails when one is missing from firestore.indexes.json: the only check before prod.
 *
 *   npx tsx scripts/list-ranged-queries.ts          # the needed indexes, and any it couldn't read
 *
 * It reads the source: `w.query("kind", (q) => …)`, `db.list(ctx, "kind", (q) => …)`, `db.listGroup(ctx, "kind", (q) => …)`,
 * with the kind as a string literal or `pathOf("kind", …)`. A query on a kind held in a variable is listed as unread.
 * `clientQueries` does the same for the browser's hooks (tenancy phase 5): every `useCollection` on an artist kind or `users`.
 */
import fs from "node:fs";
import path from "node:path";
import { ownerOf } from "@/schema/owners";

export interface Field { fieldPath: string; order?: "ASCENDING" | "DESCENDING"; arrayConfig?: "CONTAINS" }
export interface NeededIndex { collectionGroup: string; queryScope: "COLLECTION" | "COLLECTION_GROUP"; fields: Field[]; at: string }

const ROOTS = ["src", "mcp"];
const RANGE = new Set(["<", "<=", ">", ">=", "!=", "not-in"]);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** The text of a call's arguments, from just after its "(" to its matching ")". */
function argsAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/** A call's top-level arguments (commas inside brackets don't split). */
function topArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) { out.push(args.slice(start, i).trim()); start = i + 1; }
  }
  out.push(args.slice(start).trim());
  return out;
}

/** Server code only: client components and hooks are phase 5's (tests/unit/client-queries.test.ts). */
const serverFile = (f: string) => f.startsWith("mcp/") || f.startsWith("src/server/") || f.startsWith("src/app/api/");

export function rangedQueries(root = process.cwd()): { needed: NeededIndex[]; unread: string[] } {
  const needed: NeededIndex[] = [], unread: string[] = [];
  for (const r of ROOTS) for (const abs of files(path.join(root, r))) {
    const rel = path.relative(root, abs);
    if (!serverFile(rel) || rel === "src/server/db.ts") continue;
    const src = fs.readFileSync(abs, "utf8");
    const re = /\b(?:w|\w+)\.(query|list|listGroup)\(/g;
    for (let m; (m = re.exec(src)); ) {
      const args = argsAt(src, m.index + m[0].length - 1);
      const line = src.slice(0, m.index).split("\n").length;
      const at = `${rel}:${line}`;
      const kindLit = topArgs(args).slice(0, 2).map((a) => /^(?:"(\w+)"|pathOf\(\s*"(\w+)"|(tracks|entries)Path\()/.exec(a)).find(Boolean);
      const chain = args.slice(args.indexOf("=>") + 2);
      if (args.indexOf("=>") < 0) continue; // no build callback: a plain scoped list, equality only
      const wheres = [...chain.matchAll(/\.where\(\s*"([\w.]+)"\s*,\s*"([^"]+)"/g)].map((x) => ({ field: x[1], op: x[2] }));
      const orders = [...chain.matchAll(/\.orderBy\(\s*"([\w.]+)"(?:\s*,\s*"(asc|desc)")?/g)].map((x) => ({ field: x[1], dir: x[2] === "desc" ? "DESCENDING" as const : "ASCENDING" as const }));
      if (!kindLit) { if (wheres.length || orders.length) unread.push(at); continue; }
      const kind = kindLit[1] ?? kindLit[2] ?? kindLit[3];
      const group = m[1] === "listGroup";
      if (ownerOf(kind) !== "artist" && !(group && kind === "history")) continue;
      const ranged = orders.length || wheres.some((x) => RANGE.has(x.op) || x.op === "in" || x.op.startsWith("array-contains"));
      if (!ranged) continue;
      if (wheres.some((x) => x.field === "artistId")) continue; // names its own artist (system reads): its own index, listed by hand
      const fields: Field[] = [{ fieldPath: "artistId", order: "ASCENDING" }];
      for (const x of wheres) if (x.op === "==" || x.op === "in") fields.push({ fieldPath: x.field, order: "ASCENDING" });
      for (const x of wheres) if (x.op.startsWith("array-contains")) fields.push({ fieldPath: x.field, arrayConfig: "CONTAINS" });
      const range = wheres.find((x) => RANGE.has(x.op));
      if (range && orders[0]?.field !== range.field) fields.push({ fieldPath: range.field, order: "ASCENDING" });
      for (const o of orders) if (!fields.some((f) => f.fieldPath === o.field)) fields.push({ fieldPath: o.field, order: o.dir });
      if (fields.length < 2) continue;
      needed.push({ collectionGroup: kind, queryScope: group ? "COLLECTION_GROUP" : "COLLECTION", fields, at });
    }
  }
  return { needed, unread };
}

/** One query a browser hook sends (src/lib/firestore-hooks.ts), as src/lib/client-scope.ts scopes it. */
export interface ClientQuery {
  kind: string; group: boolean; at: string;
  /** Every filter the hook sends, the tenancy one included (`artistId ==`, or `artistIds array-contains` for users). */
  where: { field: string; op: string }[];
  order: { field: string; dir: "ASCENDING" | "DESCENDING" }[];
  /** Orders, ranges, `in` or an array filter: needs a composite index (equality-only queries merge single-field ones). */
  ranged: boolean;
  /** The composite index it needs, when ranged. */
  index?: NeededIndex;
}

/**
 * The browser's list queries: `useCollection("kind" | \`parent/${id}/kind\`, { where, order, group, includeDeleted })` outside the
 * server. Filters given as a variable can't be read; they are listed in `unread` as `file:line`.
 */
export function clientQueries(root = process.cwd()): { queries: ClientQuery[]; unread: string[] } {
  const queries: ClientQuery[] = [], unread: string[] = [];
  for (const abs of files(path.join(root, "src"))) {
    const rel = path.relative(root, abs);
    if (serverFile(rel) || rel === "src/lib/firestore-hooks.ts") continue;
    const src = fs.readFileSync(abs, "utf8");
    const re = /\buseCollection(?:<[^()]*?>)?\(/g;
    for (let m; (m = re.exec(src)); ) {
      const [first, opts = ""] = topArgs(argsAt(src, m.index + m[0].length - 1));
      const at = `${rel}:${src.slice(0, m.index).split("\n").length}`;
      const lit = /^"(\w+)"$/.exec(first) ?? /^`[^`/]*\/\$\{[^}]*\}\/(\w+)`$/.exec(first);
      if (!lit) { unread.push(at); continue; }
      const group = /\bgroup:\s*true\b/.test(opts);
      const kind = lit[1];
      const owner = ownerOf(kind);
      if (owner !== "artist" && kind !== "users") continue; // shared and personal kinds aren't scoped; history has its own (D4)
      const order = [...opts.matchAll(/\border:\s*\[\s*"([\w.]+)"\s*,\s*"(asc|desc)"/g)].map((x) => ({ field: x[1], dir: x[2] === "desc" ? "DESCENDING" as const : "ASCENDING" as const }));
      const filtersOf = opts.replace(/\border:\s*\[[^\]]*\]/g, "");
      const tuples = [...filtersOf.matchAll(/\[\s*"([\w.]+)"\s*,\s*"([^"]+)"/g)].map((x) => ({ field: x[1], op: x[2] }));
      if (!tuples.length && /\bwhere\b/.test(filtersOf) && !/\bwhere:\s*(\[\s*\]|undefined)/.test(filtersOf)) unread.push(at);
      const scope = owner === "artist" ? { field: "artistId", op: "==" } : { field: "artistIds", op: "array-contains" };
      const where = [scope, ...tuples.filter((t) => !(t.field === "artistId" && t.op === "==")), ...(/\bincludeDeleted\b/.test(opts) ? [] : [{ field: "deletedAt", op: "==" }])];
      const ranged = order.length > 0 || where.some((x) => RANGE.has(x.op) || x.op === "in" || x.op.startsWith("array-contains"));
      const q: ClientQuery = { kind, group, at, where, order, ranged };
      if (ranged) {
        const fields: Field[] = [];
        for (const x of where) if (x.op === "==" || x.op === "in") fields.push({ fieldPath: x.field, order: "ASCENDING" });
        for (const x of where) if (x.op.startsWith("array-contains")) fields.push({ fieldPath: x.field, arrayConfig: "CONTAINS" });
        const range = where.find((x) => RANGE.has(x.op));
        if (range && order[0]?.field !== range.field) fields.push({ fieldPath: range.field, order: "ASCENDING" });
        for (const o of order) if (!fields.some((f) => f.fieldPath === o.field)) fields.push({ fieldPath: o.field, order: o.dir });
        q.index = { collectionGroup: kind, queryScope: group ? "COLLECTION_GROUP" : "COLLECTION", fields, at };
      }
      queries.push(q);
    }
  }
  return { queries, unread };
}

const eq = (f: Field) => f.order === "ASCENDING" && !f.arrayConfig;
/** Does `ix` serve `need`? Equality fields may come in any order; the rest must match in order. */
export function serves(ix: { collectionGroup: string; queryScope: string; fields: Field[] }, need: NeededIndex): boolean {
  if (ix.collectionGroup !== need.collectionGroup || ix.queryScope !== need.queryScope || ix.fields.length !== need.fields.length) return false;
  const tailFrom = (fs: Field[]) => { let i = 0; while (i < fs.length && eq(fs[i]) && i < fs.length - 1) i++; return i; };
  const n = tailFrom(need.fields);
  const headNeed = new Set(need.fields.slice(0, n).map((f) => f.fieldPath)), headIx = new Set(ix.fields.slice(0, n).map((f) => f.fieldPath));
  if ([...headNeed].some((f) => !headIx.has(f))) return false;
  return need.fields.slice(n).every((f, i) => { const g = ix.fields[n + i]; return g.fieldPath === f.fieldPath && g.order === f.order && g.arrayConfig === f.arrayConfig; });
}

if (process.argv[1]?.endsWith("list-ranged-queries.ts")) {
  const { needed, unread } = rangedQueries();
  const line = (n: NeededIndex) => `${n.collectionGroup} ${n.queryScope} ${n.fields.map((f) => `${f.fieldPath} ${f.order ?? f.arrayConfig}`).join(", ")}  (${n.at})`;
  for (const n of needed) console.log(line(n));
  if (unread.length) console.log(`\nUnread (kind in a variable):\n${unread.join("\n")}`);
  const client = clientQueries();
  console.log("\nBrowser:");
  for (const q of client.queries) if (q.index) console.log(line(q.index));
  if (client.unread.length) console.log(`\nBrowser, unread (filters in a variable):\n${client.unread.join("\n")}`);
}
