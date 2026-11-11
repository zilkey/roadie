import { defineFake, runIfMain, type Route } from "../lib";

/** Fixed EIA v2 answer: $3.79/gal, week 2026-10-19, for every area and product. */
type State = Record<string, never>;

const routes: Route<State>[] = [
  ["GET", "/v2/petroleum/pri/gnd/data/", ({ query }) => ({
    response: { data: [{ period: "2026-10-19", value: 3.79, duoarea: query.get("facets[duoarea][]") ?? "NUS", product: query.get("facets[product][]") ?? "EPMR" }] },
  })],
];

export const fakeEia = defineFake<State>({
  name: "fake-eia", defaultPort: 3207, initial: () => ({}), routes,
  page: () => `<p>Fixed EIA weekly price: $3.790/gal, period 2026-10-19, for every area and grade.</p>`,
});
runIfMain(import.meta, fakeEia);
