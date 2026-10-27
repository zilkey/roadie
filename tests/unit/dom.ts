/**
 * A browser for component tests: a JSDOM window whose globals are copied onto `globalThis` so `react-dom/client` and
 * `@testing-library/react` work under node's test runner. Import this file first, on its own line, before anything that
 * imports react-dom. It knows nothing about any component.
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
const w = dom.window as unknown as Record<string, unknown>;
const g = globalThis as unknown as Record<string, unknown>;

for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLButtonElement", "Element", "Node", "Text", "Event", "KeyboardEvent", "FocusEvent", "MouseEvent", "InputEvent", "DocumentFragment", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "SVGElement", "CSS"]) {
  const v = k === "window" ? dom.window : w[k];
  if (v === undefined) continue;
  try { Object.defineProperty(g, k, { value: v, configurable: true, writable: true }); } catch { /* read-only in this node: leave it */ }
}
if (!("CSS" in g)) g.CSS = { supports: () => true };
g.IS_REACT_ACT_ENVIRONMENT = true;

export const jsdom = dom;
