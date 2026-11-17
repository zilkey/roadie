import "./dom";
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useNewVersion } from "@/lib/useNewVersion";

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
test.afterEach(() => { cleanup(); mock.timers.reset(); });

function server(initial: string | null) {
  const s = { id: initial, calls: 0 };
  const fetchBuildId = async () => { s.calls++; return s.id; };
  return { s, fetchBuildId };
}

test("same build: nothing to offer, on focus or on the timer", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const { s, fetchBuildId } = server("b1");
  const { result } = renderHook(() => useNewVersion("b1", fetchBuildId, 1000));
  assert.equal(s.calls, 0, "no check until focus or the timer");
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await flush();
  await act(async () => { mock.timers.tick(1000); });
  await flush();
  assert.equal(s.calls, 2);
  assert.equal(result.current, false);
});

test("a deploy since load: focus finds it and it stays found", async () => {
  const { s, fetchBuildId } = server("b2");
  const { result } = renderHook(() => useNewVersion("b1", fetchBuildId, 60_000));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await flush();
  assert.equal(result.current, true);
  s.id = "b1"; // even if the server answers the old id again (a second instance mid-rollout), the tab runs old code
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await flush();
  assert.equal(result.current, true);
  assert.equal(s.calls, 1, "stops asking once it knows");
});

test("the 10-minute timer finds a deploy too", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const { fetchBuildId } = server("b2");
  const { result } = renderHook(() => useNewVersion("b1", fetchBuildId, 1000));
  await act(async () => { mock.timers.tick(999); });
  await flush();
  assert.equal(result.current, false);
  await act(async () => { mock.timers.tick(1); });
  await flush();
  assert.equal(result.current, true);
});

test("offline or no answer is not a new version; no id of its own never asks", async () => {
  const off = server(null);
  const a = renderHook(() => useNewVersion("b1", off.fetchBuildId, 60_000));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await flush();
  assert.equal(a.result.current, false);
  assert.equal(off.s.calls, 1);
  cleanup();
  const none = server("b2");
  const b = renderHook(() => useNewVersion("", none.fetchBuildId, 60_000));
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  await flush();
  assert.equal(b.result.current, false);
  assert.equal(none.s.calls, 0);
});
