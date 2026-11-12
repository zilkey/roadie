import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

const REDIRECT = "https://claude.example/api/mcp/auth_callback";

test("Connect Roadie to Claude: sign in on /connect, pick the band, and Claude gets a working key", async ({ page, request }) => {
  const reg = await (await request.post("/oauth/register", { data: { redirect_uris: [REDIRECT], client_name: "Claude" } })).json();
  const verifier = "e2e-verifier-".repeat(5);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  // Stand in for Claude's callback so the browser has somewhere to land.
  let landed: URL | undefined;
  await page.route("https://claude.example/**", (route) => { landed = new URL(route.request().url()); return route.fulfill({ body: "back in Claude" }); });

  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "xyz" });
  await page.goto(`/oauth/authorize?${q}`);
  await expect(page).toHaveURL(/\/connect\?req=/);
  await page.getByTestId("connect-dev-rudy").click();
  await expect(page.getByRole("heading", { name: "Connect Roadie to Claude" })).toBeVisible();
  await expect(page.getByText("claude.example")).toBeVisible();
  await page.getByTestId("connect-allow").click();
  await expect(page.getByText("back in Claude")).toBeVisible();
  expect(landed!.searchParams.get("state")).toBe("xyz");

  const tok = await (await request.post("/oauth/token", { form: { grant_type: "authorization_code", code: landed!.searchParams.get("code")!, code_verifier: verifier, redirect_uri: REDIRECT, client_id: reg.client_id } })).json();
  expect(tok.access_token).toMatch(/^btk_/);
  const init = await request.post("/mcp", {
    headers: { authorization: `Bearer ${tok.access_token}`, accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } },
  });
  expect(init.status()).toBe(200);
});

test("Connect: someone without AI access is told to ask an admin", async ({ page, request }) => {
  const reg = await (await request.post("/oauth/register", { data: { redirect_uris: [REDIRECT], client_name: "Claude" } })).json();
  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: "abc", code_challenge_method: "S256" });
  await page.goto(`/oauth/authorize?${q}`);
  await page.getByTestId("connect-dev-nora").click();
  await expect(page.getByTestId("connect-no-access")).toContainText("Ask a band admin");
  await expect(page.getByTestId("connect-allow")).toBeDisabled();
});
