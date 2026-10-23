import { test, expect } from "@playwright/test";
import { A } from "./env";

test("Connect to Claude: users guide by default, developers tab on localhost", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto(A("/admin/mcp"));
  await expect(page.getByTestId("mcp-users")).toBeVisible();
  await expect(page.getByTestId("mcp-connector-url")).toHaveText(/\/mcp$/);
  await expect(page.getByTestId("mcp-developers")).toHaveCount(0);
  await page.getByTestId("mcp-tab-developers").click();
  await expect(page.getByTestId("mcp-developers")).toContainText("npm run mcp");
  await expect(page.getByTestId("mcp-users")).toHaveCount(0);
});
