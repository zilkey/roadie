"use client";
import type { PageContext } from "@/schema/assistant";

/**
 * Something on the page asking Roadie on your behalf (the day-of banner's "Record the deets"): Roadie opens, starts a
 * fresh chat and sends `text` as your message, with `pageContext` as the page it was sent from. Roadie is mounted for
 * admins only; with no Roadie listening, nothing happens.
 */
export interface RoadieAsk { text: string; pageContext: PageContext }

const EVENT = "roadie:ask";

export function askRoadie(ask: RoadieAsk) {
  window.dispatchEvent(new CustomEvent<RoadieAsk>(EVENT, { detail: ask }));
}

export function onRoadieAsk(cb: (ask: RoadieAsk) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<RoadieAsk>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
