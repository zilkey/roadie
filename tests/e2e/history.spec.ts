import { test, expect, type Page } from "@playwright/test";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer } from "../../mcp/http";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
}
const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text);
const STAMP = Date.now();

test("AI key made in the UI drives an MCP session; History shows it and Undo this run reverts it; revoking stops the key", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await signInAs(page, "jeff");

  // --- AI keys page: create, shown once, listed, never shown again
  await page.getByTestId("side-admin-ai-keys").click();
  await expect(page.getByTestId("page-title")).toHaveText("AI keys");
  const label = `Jeff · e2e ${STAMP}`;
  await page.getByTestId("key-label").fill(label);
  await page.getByTestId("key-create").click();
  const token = (await page.getByTestId("new-key-value").textContent())!.trim();
  expect(token).toMatch(/^btk_/);
  await page.getByTestId("key-done").click();
  await expect(page.getByTestId("new-key")).toHaveCount(0);
  const row = page.getByTestId(`key-${label}`);
  await expect(row).toContainText("active");
  await expect(row).toContainText("last used never");
  await page.reload();
  await expect(page.getByTestId("key-list")).not.toContainText(token);

  // --- an AI session makes changes
  const server = createHttpServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  const client = new Client({ name: "e2e", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const v = (n: string) => ({ name: n, type: "bar", address: { city: "Denver", state: "CO" }, region: "denver", contactIds: [], promoterIds: [] });
    const a = text(await client.callTool({ name: "venues.create", arguments: v(`AI Room One ${STAMP}`) }));
    const b = text(await client.callTool({ name: "venues.create", arguments: v(`AI Room Two ${STAMP}`) }));
    expect(a.runId).toBe(b.runId);
    const bad = await client.callTool({ name: "venues.create", arguments: { name: "x" } });
    expect(bad.isError).toBe(true);
    expect(text(bad).error.issues.length).toBeGreaterThan(0);
    const runId: string = a.runId;

    // last used shows up on the keys page
    await page.reload();
    await expect(page.getByTestId(`key-${label}`)).not.toContainText("last used never");

    // --- History page
    await page.getByTestId("side-admin-history").click();
    await expect(page.getByTestId("page-title")).toHaveText("History");
    await page.getByTestId("filter-via").selectOption("mcp");
    await page.getByTestId("filter-entity").fill("venues");
    const rows = page.getByTestId("history-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("mcp");
    await expect(rows.first()).toContainText("Jeff");
    await expect(rows.first()).toContainText("create");
    await rows.first().locator("summary").click();
    await expect(rows.first().getByTestId("diff")).toContainText("AI Room");

    // filter by run and undo it
    await page.getByTestId("filter-via").selectOption("");
    await page.getByTestId("filter-entity").fill("");
    await page.getByTestId("filter-run").fill(runId);
    await expect(page.getByTestId("run-card")).toContainText("2 changes");
    await expect(page.getByTestId("run-card")).toContainText("via mcp");
    await page.getByTestId("undo-run").click();
    await expect(page.getByTestId("undo-counts")).toContainText("2 put back");
    await expect(page.getByTestId("undo-manual")).toHaveCount(0);

    // the reversal is in history under a new run id
    await page.getByTestId("filter-run").fill("");
    await page.getByTestId("filter-via").selectOption("app");
    await page.getByTestId("filter-entity").fill("venues");
    await expect(page.locator('[data-testid="history-row"][data-op="delete"]')).toHaveCount(2);
    await expect(page.locator(`[data-testid="history-row"][data-run="${runId}"]`)).toHaveCount(0);

    // the venues are gone from search
    const found = text(await client.callTool({ name: "search", arguments: { q: `AI Room ${STAMP}` } }));
    expect(found.result.count).toBe(0);

    // --- a member cannot open History
    const m = await browser.newContext();
    const mp = await m.newPage();
    await signInAs(mp, "david");
    await mp.goto("/admin/history");
    await expect(mp).toHaveURL(/\/home$/);
    await m.close();

    // --- revoke
    await page.getByTestId("side-admin-ai-keys").click();
    await page.getByTestId(`key-${label}`).getByTestId("key-revoke").click();
    await expect(page.getByTestId(`key-${label}`)).toContainText("revoked");
    await expect(client.callTool({ name: "stats.current", arguments: {} })).rejects.toThrow(/revoked/);
  } finally {
    await client.close().catch(() => {});
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test("undo from the History page for an app change restores the earlier value", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await signInAs(page, "jeff");
  await page.getByTestId("tab-booking").click();
  // add a venue through the app so the run is a plain app run
  const name = `Undo Me ${STAMP}`;
  await page.getByTestId("add-venue").click();
  await page.getByTestId("new-venue-name").fill(name);
  await page.getByTestId("new-venue-city").fill("Boulder");
  await page.getByTestId("new-venue-submit").click();
  await page.getByTestId("booking-search").fill(name);
  await expect(page.getByTestId(/^row-venue-/)).toHaveCount(1);

  await page.getByTestId("side-admin-history").click();
  await page.getByTestId("filter-via").selectOption("app");
  await page.getByTestId("filter-entity").fill("venues");
  const row = page.locator('[data-testid="history-row"]', { hasText: "create" }).first();
  await expect(row).toBeVisible();
  await row.getByTestId("pick-run").click();
  await page.getByTestId("undo-run").click();
  await expect(page.getByTestId("undo-counts")).toContainText("put back");

  await page.goto("/booking");
  await page.getByTestId("booking-search").fill(name);
  await expect(page.getByTestId(/^row-venue-/)).toHaveCount(0);
});
