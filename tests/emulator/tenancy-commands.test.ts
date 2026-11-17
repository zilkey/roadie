import { test, before } from "node:test";
import assert from "node:assert/strict";
import type { z } from "zod";
import { execute } from "@/server/commands/dispatch";
import { registry } from "@/server/commands/registry";
import { artistCtx, type Ctx } from "@/server/ctx";
import { db } from "@/server/db";
import { OWNERS } from "@/schema/owners";
import { resetEmulators, SYS } from "./helpers";
import { seedArtists, ARTIST_KINDS, SUB_KINDS, type SeededArtist } from "./fixtures";

// Tenancy plan phase 4: no command, run as artist A, reads or changes artist B's records. Seeds A and B with one record of every
// artist kind (fixtures.ts), plus a person who is a member of A and an admin of B.

let A: SeededArtist, B: SeededArtist, both: { uid: string };
before(async () => {
  await resetEmulators();
  ({ A, B, both } = await seedArtists("A", "B"));
});

const as = (uid: string, role: "admin" | "member", artistId = "A"): Ctx => artistCtx({ uid, role, artistId, via: "app" });

/** Every id of B's records (and of B's people and musicians), for spotting B's data in a result. */
const bIds = () => new Set([...Object.values(B.records).map((r) => r.id), B.refs.musicianId, B.refs.memberMusicianId, B.admin.uid, B.member.uid].filter((x) => !x.startsWith("fx-")));

/** Every string anywhere in a value. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** B's documents (every artist kind, the artist doc, B's people) and their history, as one comparable snapshot. */
async function snapshotB(): Promise<string> {
  const out: Record<string, unknown> = {};
  for (const kind of ARTIST_KINDS) {
    const rows = (SUB_KINDS as string[]).includes(kind)
      ? await db.listGroup(SYS, kind, (q) => q.where("artistId", "==", "B"))
      : await db.list(SYS, kind, (q) => q.where("artistId", "==", "B"), { includeDeleted: true });
    for (const r of rows) out[`${kind}/${r.id}`] = r;
  }
  out["artists/B"] = await db.get(SYS, "artists", "B");
  for (const uid of [B.admin.uid, B.member.uid]) out[`users/${uid}`] = await db.get(SYS, "users", uid);
  const hist = await db.listGroup(SYS, "history", (q) => q.where("artistId", "==", "B"));
  out.history = hist.map((h) => h.path).sort();
  return JSON.stringify(out, (_k, v) => (v && typeof v === "object" && typeof v.toMillis === "function" ? v.toMillis() : v));
}

const READ_COMMANDS = Object.values(registry).filter((c) => /^Read-only/i.test(c.description) || /\.(list|get|pending|counts|summary|check|movement|missingFiles|needingFollowUp|myRuns)$/.test(c.name) || c.name === "search");

test("read commands as A's admin and A's member return none of B's records", async () => {
  const ids = bIds();
  const readable = (registry["records.list"].input as unknown as { shape: { kind: { options: string[] } } }).shape.kind.options;
  for (const who of [as(A.admin.uid, "admin"), as(A.member.uid, "member"), as(both.uid, "member")]) {
    for (const kind of readable) {
      if (!registry["records.list"].roles.includes(who.role)) continue;
      const r = await execute(who, "records.list", { kind, limit: 200 }).catch(() => null);
      const leak = r ? strings(r.result).filter((s) => ids.has(s)) : [];
      assert.deepEqual(leak, [], `records.list ${kind} as ${who.role}`);
    }
    for (const c of READ_COMMANDS) {
      if (!c.roles.includes(who.role)) continue;
      const input = c.name === "search" ? { q: "a" } : c.name === "availability.check" ? { dates: ["2027-05-01"] } : {};
      const r = await execute({ ...who, runId: `r-${c.name}-${who.uid}` }, c.name, input).catch(() => null);
      const leak = r ? strings(r.result).filter((s) => ids.has(s)) : [];
      assert.deepEqual(leak, [], `${c.name} as ${who.role}`);
    }
    for (const [kind, rec] of Object.entries(B.records)) {
      const readableKind = readable.includes(kind);
      if (!readableKind || (SUB_KINDS as string[]).includes(kind) || !registry["records.get"].roles.includes(who.role)) continue;
      const r = await execute(who, "records.get", { kind, id: rec.id }).catch((e) => e);
      assert.equal(r.code, "not_found", `records.get ${kind}/${rec.id} as ${who.role}`);
    }
  }
});

// ---------- every command, with B's ids in every id field ----------

type Def = { type: string; shape?: Record<string, z.ZodType>; element?: z.ZodType; innerType?: z.ZodType; in?: z.ZodType; options?: z.ZodType[]; entries?: Record<string, string>; values?: unknown[] };
const def = (s: z.ZodType) => (s as unknown as { _zod: { def: Def } })._zod.def;
/** The kind an id field names: `showId` -> shows; `id` -> the command's own kind (`shows.update` -> shows). */
function kindFor(key: string, cmd: string): string | undefined {
  const k = key.replace(/Ids?$/, "");
  const plural = `${k}s`;
  if (key === "id" || key === "ids") {
    const head = cmd.split(".")[0];
    return (OWNERS as Record<string, string>)[head] ? head : undefined;
  }
  if ((OWNERS as Record<string, string>)[plural]) return plural;
  if (k === "musician") return "musicians";
  if (k === "keep" || k === "merge") return "songs";
  return undefined;
}
function bIdFor(kind: string | undefined): string {
  if (!kind) return B.records.shows.id;
  if (kind === "artists") return "B";
  if (kind === "users") return B.admin.uid;
  if (kind === "musicians") return B.refs.musicianId;
  return (B.records as Record<string, { id: string }>)[kind]?.id ?? (B.refs as unknown as Record<string, string>)[kind] ?? B.records.shows.id;
}
/** A value for `s` with B's ids in every id field. */
function fake(s: z.ZodType, key: string, cmd: string): unknown {
  const d = def(s);
  switch (d.type) {
    case "optional": case "nullable": case "default": case "readonly": case "catch": case "nonoptional": return fake(d.innerType!, key, cmd);
    case "pipe": return fake(d.in!, key, cmd);
    case "object": return Object.fromEntries(Object.entries(d.shape!).map(([k, v]) => [k, fake(v, k, cmd)]).filter(([, v]) => v !== undefined));
    case "array": { const one = fake(d.element!, key.replace(/s$/, ""), cmd); return one === undefined ? [] : [one]; }
    case "union": return fake(d.options![0], key, cmd);
    case "enum": return Object.values(d.entries!)[0];
    case "literal": return d.values![0];
    case "number": case "int": return 1;
    case "boolean": return false;
    case "date": return new Date("2027-05-01");
    case "record": return {};
    case "string": return /id$|ids?$/i.test(key) ? bIdFor(kindFor(key, cmd)) : /date|day/i.test(key) ? "2027-05-01" : /email/i.test(key) ? "x@example.com" : "x";
    default: return undefined;
  }
}

/** Commands that reach outside Firestore in ways a test can't stand in for, or that need a platform admin (A's admin isn't one). */
const SKIP = new Set<string>([]);

test("every registry command, run as A's admin with B's ids, leaves B's documents and history unchanged", { timeout: 600_000 }, async () => {
  const before = await snapshotB();
  const reached: string[] = [], unparsed: string[] = [];
  for (const c of Object.values(registry)) {
    if (SKIP.has(c.name)) continue;
    const input = fake(c.input, "", c.name);
    const ctx: Ctx = { ...as(A.admin.uid, "admin"), role: c.roles.includes("admin") ? "admin" : c.roles[0] };
    // Refused is what we want; a fake input that didn't parse never reached the command (counted below).
    try { await execute(ctx, c.name, input); reached.push(c.name); } catch (e) { if ((e as { code?: string }).code !== "invalid_input") reached.push(c.name); else unparsed.push(c.name); }
  }
  if (process.env.TENANCY_DEBUG) console.log(`reached ${reached.length}, unparsed ${unparsed.length}: ${unparsed.join(" ")}`);
  // The walk is only worth something if most commands got past their input schema with B's ids in them.
  assert.ok(reached.length > unparsed.length * 2, `only ${reached.length} commands reached their run; ${unparsed.length} didn't parse`);
  assert.equal(await snapshotB(), before, "B's records or history changed");
  assert.ok(Object.keys(registry).length > 200);
});

test("gas and driving: A can't estimate gas from, or change the driving of, someone only in B", async () => {
  const admin = as(A.admin.uid, "admin");
  await assert.rejects(execute(admin, "expenses.estimateGas", { forId: B.member.uid, to: { address: "Boulder", lat: 40, lng: -105 } }), { code: "not_found" });
  await assert.rejects(execute(admin, "people.updateDriving", { userId: B.member.uid, home: null }), { code: "not_found" });
});

test("the person in both artists: as A's member they see A's records only, as B's admin B's", async () => {
  const inA = await execute(as(both.uid, "member"), "tours.list", {});
  assert.ok(!strings(inA.result).includes(B.records.tours.id));
  const inB = await execute(as(both.uid, "admin", "B"), "records.list", { kind: "tours" });
  assert.ok(strings(inB.result).includes(B.records.tours.id));
  assert.ok(!strings(inB.result).includes(A.records.tours.id));
});
