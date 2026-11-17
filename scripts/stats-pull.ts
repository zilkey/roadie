/**
 * Daily Spotify pull. `npm run stats:pull` (emulator) -- cron wires this up later. One pull per live artist, each with that
 * artist's context, so every snapshot carries its artist (tenancy phase 2). `--artist <id>` pulls for one.
 */
import { importCtx, systemCtx } from "@/server/ctx";
import { db } from "@/server/db";
import { pullSpotify } from "@/server/commands/stats";

async function main() {
  const i = process.argv.indexOf("--artist");
  const only = i > 0 ? process.argv[i + 1] : undefined;
  const artists = (await db.list(systemCtx("stats-pull"), "artists")).filter((a) => !only || a.id === only);
  if (only && !artists.length) throw new Error(`No artist ${only}`);
  for (const a of artists) {
    const r = await pullSpotify(importCtx(a.id, "stats-pull"));
    console.log(`${a.name}: Spotify ${r.date}: ${r.followers} followers, popularity ${r.popularity}${r.written.length ? " (saved)" : " (already saved today)"}`);
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
