import test from "node:test";
import assert from "node:assert/strict";
import { canGoBack, nextStack } from "../../src/lib/navHistory";

test("a fresh load has nowhere to go back to", () => {
  assert.equal(canGoBack(nextStack([], "/a")), false);
});
test("navigating forward pushes, the same page twice does not", () => {
  const s = nextStack(nextStack(nextStack([], "/a"), "/b"), "/b");
  assert.deepEqual(s, ["/a", "/b"]);
  assert.equal(canGoBack(s), true);
});
test("landing on the previous page pops the stack", () => {
  const s = nextStack(["/a", "/b", "/c"], "/b");
  assert.deepEqual(s, ["/a", "/b"]);
  assert.equal(canGoBack(nextStack(s, "/a")), false);
});
