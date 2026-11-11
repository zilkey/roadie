/**
 * Shared calendar templates: several rooms on one page or one platform. A venue picks a preset and adds only its filter
 * (filter.venueName for a page that lists several rooms). Selectors were proposed by Gemini from the live pages and checked
 * against them (issue #60). Fixtures of each page are in tests/fixtures/calendars/.
 */
import type { SelectorConfig } from "./selectors";
import type { PRESETS } from "@/schema";

export const PRESET_DEFS: Record<(typeof PRESETS)[number], Partial<SelectorConfig>> = {
  z2: {"item": ".events_list.slide_from-side .events_item", "fields": {"title": "h3.heading-style-h5", "date": ".date > div:nth-child(3)", "url": {"sel": "a.events_image-wrapper", "attr": "href"}, "image": {"sel": "img.events_image", "attr": "src"}, "venue": ".move"}, "dateFormat": "MMM D, YYYY h:mm A"},
  rockhouse: {"item": ".eventWrapper", "fields": {"title": ".eventTitleDiv h2", "date": ".singleEventDate", "time": ".eventDoorStartDate span", "doors": ".eventDoorStartDate span", "url": {"sel": ".eventTitleDiv a", "attr": "href"}, "image": {"sel": ".rhp-events-event-image img", "attr": "src"}, "venue": "a.venueLink"}, "dateFormat": "ddd, MMM D"},
  "downtown-longmont": {"item": "a.evcard", "fields": {"title": ".evcard-content-headline", "date": ".evcard-date-box", "time": ".evcard-content-time", "url": {"sel": "", "attr": "href"}, "image": {"sel": ".evcard-image-image", "attr": "data-src"}, "venue": ".evcard-content-venue"}},
  tickettailor: {"item": "li.main-events-listing__event", "fields": {"title": "a.event__link", "date": ".event-meta__date", "time": ".event-meta__date var:nth-of-type(3)", "url": {"sel": "a.event__link", "attr": "href"}, "image": {"sel": "figure.event__image img", "attr": "src"}, "venue": ".event-meta__location"}},
};
