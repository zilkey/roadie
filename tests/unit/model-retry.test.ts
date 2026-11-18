import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL_WAITS, withModelRetry } from "@/server/assistant/ai";

const busy = () => Object.assign(new Error("429"), { status: "RESOURCE_EXHAUSTED" });

test("withModelRetry: rides out busy answers, telling onWait each time, and gives up only after the last wait", async () => {
  let n = 0;
  const waits: number[] = [];
  const out = await withModelRetry(async () => { if (++n < 4) throw busy(); return "ok"; }, [0, 0, 0, 0], (i) => waits.push(i));
  assert.equal(out, "ok");
  assert.deepEqual(waits, [0, 1, 2]);
  n = 0;
  await assert.rejects(withModelRetry(async () => { n++; throw busy(); }, [0, 0]), /429/);
  assert.equal(n, 3);
  // Anything but busy fails at once.
  n = 0;
  await assert.rejects(withModelRetry(async () => { n++; throw Object.assign(new Error("bad"), { status: "INVALID_ARGUMENT" }); }, [0]), /bad/);
  assert.equal(n, 1);
  // Prod waits cover more than the 47 seconds of 429s seen 2026-11-18.
  assert.ok(MODEL_WAITS.reduce((a, b) => a + b, 0) > 60_000);
});
