/** Daily Spotify pull. `npm run stats:pull` (emulator) -- cron wires this up later. */
import { importCtx } from "@/server/ctx";
import { pullSpotify } from "@/server/commands/stats";

pullSpotify(importCtx("stats-pull")).then(
  (r) => { console.log(`Spotify ${r.date}: ${r.followers} followers, popularity ${r.popularity}${r.written.length ? " (saved)" : " (already saved today)"}`); process.exit(0); },
  (e) => { console.error(e); process.exit(1); },
);
