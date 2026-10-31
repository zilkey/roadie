import { z } from "zod";
import { db, run } from "../db";
import { AppError } from "../errors";
import { defineCommand } from "./types";
import { spotifyClient } from "../integrations";
import { parseSpotifyCsv, statsCurrent, type StatLike } from "@/lib/stats";
import type { Ctx } from "../ctx";

/** Writes a snapshot with id `{source}_{date}`; snapshots are never edited, so an existing day is skipped. */
async function writeSnapshots(ctx: Ctx, snaps: Record<string, unknown>[]) {
  return run(ctx, async (w) => {
    const written: string[] = [], skipped: string[] = [];
    for (const s of snaps) {
      const id = `${s.source}_${s.date}`;
      if (await w.get("statSnapshots", id)) { skipped.push(id); continue; }
      await w.create("statSnapshots", s, { id });
      written.push(id);
    }
    return { written, skipped };
  });
}

/** The daily Spotify pull. Also run by `npm run stats:pull`. */
export async function pullSpotify(ctx: Ctx) {
  const a = await spotifyClient().artist();
  const r = await writeSnapshots(ctx, [{ source: "spotifyApi", date: a.date, followers: a.followers, popularity: a.popularity }]);
  return { date: a.date, followers: a.followers, popularity: a.popularity, ...r };
}

export async function currentStats() {
  const snaps = (await db.list("statSnapshots")) as unknown as StatLike[];
  return statsCurrent(snaps);
}

export const statsPull = defineCommand({
  name: "stats.pull", roles: ["admin", "mcp"], input: z.strictObject({}),
  description: "Pull today's followers and popularity from Spotify and store a statSnapshot (id spotifyApi_{date}). A day already pulled is skipped.",
  run: (ctx) => pullSpotify(ctx),
});

export const statsImportCsv = defineCommand({
  name: "stats.importCsv", roles: ["admin", "mcp"],
  description: "Import a Spotify for Artists CSV (columns: date or month, listeners, streams, optional followers). Each row becomes a spotifyForArtists_{date} snapshot; dates already imported are skipped. Nothing is written if any line is bad.",
  input: z.strictObject({ csv: z.string().min(1), fileName: z.string().optional() }),
  async run(ctx, { csv }) {
    const { rows, errors } = parseSpotifyCsv(csv);
    if (errors.length) throw new AppError("invalid_csv", errors.slice(0, 5).join("; "), 400, errors.map((m) => ({ path: "csv", code: "custom", message: m })));
    if (!rows.length) throw new AppError("invalid_csv", "No data rows found", 400);
    const r = await writeSnapshots(ctx, rows.map((x) => ({ source: "spotifyForArtists", ...x })));
    return { rows: rows.length, ...r };
  },
});

export const statsCurrentCmd = defineCommand({
  name: "stats.current", roles: ["admin", "mcp"], input: z.strictObject({}),
  description: "The latest followers, monthly listeners, streams and popularity (with the date and source of each). Use for pitch emails.",
  run: () => currentStats(),
});

export const statsCommands = [statsPull, statsImportCsv, statsCurrentCmd];
