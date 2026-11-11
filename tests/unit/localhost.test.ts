import { test } from "node:test";
import assert from "node:assert/strict";
import { hostnameOf, isLocalRequest } from "@/lib/localhost";

const req = (h: Record<string, string>) => new Headers(h);

test("hostnameOf drops ports and IPv6 brackets", () => {
  assert.equal(hostnameOf("127.0.0.1:3100"), "127.0.0.1");
  assert.equal(hostnameOf("LocalHost"), "localhost");
  assert.equal(hostnameOf("[::1]:3100"), "::1");
  assert.equal(hostnameOf("::1"), "::1");
});

test("only localhost, 127.0.0.1 and ::1 count as local; a proxy's forwarded host must be local too", () => {
  for (const host of ["127.0.0.1:3100", "localhost:3100", "localhost", "[::1]:3100"]) assert.equal(isLocalRequest(req({ host })), true, host);
  for (const host of ["roadie-web-prod--roadie-prod-iab.us-central1.hosted.app", "localhost.evil.com", "127.0.0.2", "10.0.0.5:3100"]) {
    assert.equal(isLocalRequest(req({ host })), false, host);
  }
  assert.equal(isLocalRequest(req({})), false);
  assert.equal(isLocalRequest(req({ host: "127.0.0.1:8080", "x-forwarded-host": "roadie.example.com" })), false);
  assert.equal(isLocalRequest(req({ host: "127.0.0.1:3100", "x-forwarded-host": "localhost:3100" })), true);
});
