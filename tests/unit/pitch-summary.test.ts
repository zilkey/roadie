import { test } from "node:test";
import assert from "node:assert/strict";
import { pastPitches, pitchOutcome, pitchWhen } from "@/lib/pitchSummary";

const at = (n: number) => ({ toMillis: () => n });
const pitch = (status: string, extra: { id?: string; createdAt?: unknown; lastContactAt?: unknown } = {}) => ({ status, showIds: [] as string[], ...extra });

test("outcome: booked became a show", () => {
  assert.equal(pitchOutcome(pitch("booked")), "Became a show");
});
test("outcome: declined", () => {
  assert.equal(pitchOutcome(pitch("declined")), "Declined");
});
test("outcome: dropped", () => {
  assert.equal(pitchOutcome(pitch("dropped")), "Dropped");
});
test("outcome: any status with shows became a show", () => {
  assert.equal(pitchOutcome({ status: "declined", showIds: ["s1"] }), "Became a show");
  assert.equal(pitchOutcome({ status: "dropped", showIds: ["s1"] }), "Became a show");
});

test("pitchWhen prefers last contact over created", () => {
  assert.equal(pitchWhen({ lastContactAt: at(500), createdAt: at(100) }), 500);
});
test("pitchWhen falls back to created, then 0", () => {
  assert.equal(pitchWhen({ createdAt: at(100) }), 100);
  assert.equal(pitchWhen({}), 0);
});

test("pastPitches drops active statuses and sorts newest first", () => {
  const rows = [
    pitch("idea", { id: "a", createdAt: at(9) }),
    pitch("toPitch", { id: "b", createdAt: at(9) }),
    pitch("pitched", { id: "c", createdAt: at(9) }),
    pitch("talking", { id: "d", createdAt: at(9) }),
    pitch("dropped", { id: "old", createdAt: at(100) }),
    pitch("booked", { id: "new", createdAt: at(50), lastContactAt: at(300) }),
    pitch("declined", { id: "mid", createdAt: at(200) }),
  ];
  assert.deepEqual(pastPitches(rows).map((p) => p.id), ["new", "mid", "old"]);
});
