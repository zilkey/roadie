import { defineFake, runIfMain, type Route } from "../lib";

/** Fixed answers for any query so e2e is deterministic. Speaks the Pelias/ORS routes src/server/integrations/ors.ts calls. */
type State = Record<string, never>;

const feature = (label: string, coordinates: [number, number], extra: Record<string, string> = {}) => ({
  geometry: { coordinates },
  properties: { label, county: "Denver County", region_a: "CO", ...extra },
});
const CHAMPA = feature("2363 Champa St, Denver, CO, USA", [-104.9868, 39.7526]);
const LOFT = feature("2363 Champa St, Denver, CO, USA", [-104.9868, 39.7526], { name: "The Loft", layer: "venue" });
const HOME = feature("742 Evergreen Terrace, Denver, CO, USA", [-104.9503, 39.7005]);

/** Deterministic coordinates for any text (a hash, spread over the lower 48), so the same city always lands in the same place. */
function spot(text: string): [number, number] {
  let h = 2166136261;
  for (const c of text.trim().toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return [-124 + (h % 5700) / 100, 25 + ((h >>> 12) % 2300) / 100];
}

const routes: Route<State>[] = [
  ["GET", "/geocode/search", ({ query }) => {
    const text = query.get("text") ?? "";
    return { features: text.trim() ? [feature(`${text}, USA`, spot(text))] : [] };
  }],
  ["GET", "/geocode/autocomplete", () => ({ features: [CHAMPA, LOFT, HOME] })],
  ["GET", "/geocode/reverse", () => ({ features: [CHAMPA] })],
  ["POST", "/v2/directions/driving-car", () => ({ routes: [{ summary: { distance: 29611.93, duration: 1560 } }] })],
];

export const fakeOrs = defineFake<State>({
  name: "fake-ors", defaultPort: 3206, initial: () => ({}), routes,
  page: () => `<p>Fixed OpenRouteService answers: autocomplete returns 3 Denver places, search returns one deterministic point per text, reverse returns Denver County, CO, directions is always 18.4 mi (29611.93 m) and 26 min (1560 s).</p>`,
});
runIfMain(import.meta, fakeOrs);
