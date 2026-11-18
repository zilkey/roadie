import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, ipKey, signUpTriesId } from "@/server/usage";

test("clientIp: the client is second from the right; what the client prepends is ignored", () => {
  assert.equal(clientIp(null), null);
  assert.equal(clientIp(""), null);
  assert.equal(clientIp("203.0.113.7"), "203.0.113.7");
  assert.equal(clientIp("203.0.113.7, 35.191.0.1"), "203.0.113.7");
  // a made-up address sent by the client lands on the left and changes nothing
  assert.equal(clientIp("1.2.3.4, 203.0.113.7, 35.191.0.1"), "203.0.113.7");
  assert.equal(clientIp(" 9.9.9.9 ,203.0.113.7 , 35.191.0.1 "), "203.0.113.7");
});

test("ipKey: a short stable hash, never the address", () => {
  const k = ipKey("203.0.113.7");
  assert.match(k, /^[0-9a-f]{16}$/);
  assert.equal(k, ipKey("203.0.113.7"));
  assert.notEqual(k, ipKey("203.0.113.8"));
  assert.ok(!k.includes("203"));
});

test("signUpTriesId: one counter doc per UTC hour", () => {
  assert.equal(signUpTriesId(new Date("2026-11-17T23:59:59Z")), "signUp_2026-11-17T23");
  assert.equal(signUpTriesId(new Date("2026-11-18T00:00:00Z")), "signUp_2026-11-18T00");
});
