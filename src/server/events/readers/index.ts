import type { VenueCalendar } from "@/schema";
import type { Reader } from "../types";
import { readSelectors } from "../selectors";
import { readSquarespace } from "./squarespace";
import { readTribe } from "./tribe";
import { readIcs } from "./ics";
import { readJsonLd } from "./jsonld";
import { readAeg } from "./aeg";
import { readPlot } from "./plot";
import { readVenueNetwork } from "./venueNetwork";
import { readWix } from "./wix";
import { readEventbrite } from "./eventbrite";

/** One small reader per kind of calendar. `manual` has none. */
export const READERS: { [T in Exclude<VenueCalendar["type"], "manual">]: Reader<T> } = {
  squarespace: readSquarespace, tribe: readTribe, ics: readIcs, jsonld: readJsonLd, aeg: readAeg, plot: readPlot,
  "venue-network": readVenueNetwork, wix: readWix, eventbrite: readEventbrite, selectors: readSelectors,
};
