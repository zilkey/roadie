/**
 * EIA API v2, petroleum/pri/gnd: weekly retail gasoline/diesel prices by area and grade.
 * Locally the fake at fakes/fake-eia answers; in production set EIA_BASE_URL=https://api.eia.gov
 * and the secret EIA_API_KEY (free key at eia.gov/opendata/register.php).
 */
import { jsonClient } from "./http";

export interface EiaWeeklyPrice {
  /** YYYY-MM-DD, the Monday the price is for. */
  period: string;
  /** $/gal. */
  value: number;
}

export interface EiaService {
  /** The latest weekly price for one area (duoarea facet) and product (grade facet), or null when EIA has no row. */
  latest(opts: { duoarea: string; product: string }): Promise<EiaWeeklyPrice | null>;
}

export function eiaClient(baseUrl = process.env.EIA_BASE_URL ?? "http://127.0.0.1:3207"): EiaService {
  const call = jsonClient("eia", baseUrl);
  return {
    async latest({ duoarea, product }) {
      const r = await call<{ response: { data: { period: string; value: number | string }[] } }>("GET", "/v2/petroleum/pri/gnd/data/", {
        query: {
          api_key: process.env.EIA_API_KEY ?? "", frequency: "weekly", "data[0]": "value",
          "facets[duoarea][]": duoarea, "facets[product][]": product,
          "sort[0][column]": "period", "sort[0][direction]": "desc", length: "1",
        },
      });
      const row = r.response?.data?.[0];
      return row ? { period: row.period, value: Number(row.value) } : null;
    },
  };
}
