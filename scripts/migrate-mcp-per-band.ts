/**
 * AI (MCP) access is per band now: it lives on each membership (`artists[].mcpAccess`), not on the user:
 *   tsx scripts/migrate-mcp-per-band.ts [--dry-run] [--yes]
 * Copies the old top-level `mcpAccess` onto every admin membership that has no flag of its own (member and ai memberships
 * get none), then removes the top-level field. Reads work without running this (mcpIn falls back to the old flag for
 * admins), so it is optional tidying. Live docs go through the normal writer (history + rev, via "import");
 * soft-deleted users are fixed in place. Safe to run again. Against real Firestore (no emulator host) it needs --yes.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { db } from "@/server/db";

export interface McpPerBandResult { users: { id: string; email: string; admin: number }[] }

export async function migrateMcpPerBand(fs: Firestore, opts: { dryRun?: boolean } = {}): Promise<McpPerBandResult> {
  const ctx = importCtx("migrate-mcp-per-band");
  const docs = (await fs.collection("users").get()).docs.map((d) => ({ id: d.id, ...d.data() }) as { id: string; email?: string; mcpAccess?: unknown; artists?: { artistId: string; role: string; mcpAccess?: boolean }[]; deletedAt?: unknown });
  const out: McpPerBandResult["users"] = [];
  for (const u of docs) {
    if (!("mcpAccess" in u)) continue;
    const old = u.mcpAccess === true;
    const artists = (u.artists ?? []).map((m) => (m.role === "admin" && typeof m.mcpAccess !== "boolean" ? { ...m, mcpAccess: old } : m));
    out.push({ id: u.id, email: u.email ?? "", admin: artists.filter((m) => m.role === "admin" && m.mcpAccess).length });
    if (opts.dryRun) continue;
    if (u.deletedAt) await fs.collection("users").doc(u.id).update({ artists, mcpAccess: FieldValue.delete() });
    else await db.update(ctx, "users", u.id, { artists, mcpAccess: null });
  }
  return { users: out };
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await migrateMcpPerBand(firestore(), { dryRun: flag("dry-run") });
  for (const u of r.users) console.log(`${flag("dry-run") ? "Would update" : "Updated"} ${u.email || u.id}: AI access on ${u.admin} admin membership(s)`);
  console.log(`${r.users.length} user(s) ${flag("dry-run") ? "need" : "moved to"} per-band AI access.`);
}

if (process.argv[1]?.endsWith("migrate-mcp-per-band.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
