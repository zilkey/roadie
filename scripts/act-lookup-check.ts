/**
 * `npm run check:acts:vertex -- "A Brother's Fountain" "played Aggie Theatre in Fort Collins, CO"`: one act's Look up web half (#78)
 * against the REAL model (Vertex through the service-account key in .secrets) and the real web: grounded search, the grounding
 * redirects resolved, the structured extraction, and which links survived the grounding check. Writes nothing. With
 * SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET set it also runs the real Spotify search; otherwise that half is skipped.
 */
import { modelLabel, modelMode } from "../src/server/assistant/ai";
import { sameName, webFacts } from "../src/server/assistant/actLookup";
import { spotifyCatalog } from "../src/server/integrations/spotify";

async function main() {
  const [name = "A Brother's Fountain", hint = ""] = process.argv.slice(2);
  if (modelMode() === "fake") throw new Error("ROADIE_MODEL is fake; this check only means something against the real model");
  const started = Date.now();
  const found = await webFacts(name, hint);
  console.log(`${modelLabel()} (${modelMode()}) in ${Date.now() - started}ms`);
  console.log(JSON.stringify(found, null, 2));
  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && !process.env.SPOTIFY_BASE_URL) {
    const hits = await spotifyCatalog().searchArtists(name);
    console.log(`spotify: ${hits.length} hits, ${sameName(hits, name).length} with exactly this name`, JSON.stringify(sameName(hits, name), null, 2));
  } else console.log("spotify: skipped (no SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET)");
}

main().catch((e) => { console.error(e); process.exit(1); });
