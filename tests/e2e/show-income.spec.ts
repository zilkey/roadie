import { test, expect } from "@playwright/test";
import { A } from "./env";

test("Income card: start from a starter, edit lines, validate, save, and see the total", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto(A("/shows"));
  const id = await page.locator('[data-testid="shows-row"]').first().getAttribute("data-id");
  await page.goto(A(`/shows/${id}?tab=finances`));

  const card = page.getByTestId("income");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("admin-only")).toBeVisible();

  // empty: the yellow starter box
  await expect(card.getByTestId("income-empty")).toContainText("What's the deal?");
  await card.getByTestId("income-start-guarantee").click();
  await expect(card.getByTestId("income-row")).toHaveCount(1);
  await expect(card.getByTestId("income-what")).toHaveValue("guarantee");

  // an invalid amount blocks the save
  await card.getByTestId("income-amount").fill("lots");
  await card.getByTestId("income-save").click();
  await expect(card.getByTestId("income-amount-error")).toBeVisible();
  await expect(card).toHaveAttribute("data-editing", "1");

  await card.getByTestId("income-amount").fill("$250.00");
  await card.getByTestId("income-how").selectOption("check");
  await card.getByTestId("income-received").check();
  await card.getByTestId("income-add").click();
  const rows = card.getByTestId("income-row");
  await rows.nth(1).getByTestId("income-what").selectOption("tips");
  await rows.nth(1).getByTestId("income-amount").fill("84");
  await expect(card.getByTestId("income-total")).toContainText("$334.00");
  await card.getByTestId("income-notes").fill("Check made out to the LLC");
  await card.getByTestId("income-save").click();

  await expect(card).not.toHaveAttribute("data-editing", "1");
  await expect(card.getByTestId("income-line")).toHaveCount(2);
  await expect(card.getByTestId("income-line").first()).toContainText("Guarantee · Check · received");
  await expect(card.getByTestId("income-total")).toContainText("$334.00");
  await expect(card.getByTestId("income-notes-view")).toHaveText("Check made out to the LLC");

  // remove a line, cancel discards, save persists
  await card.getByTestId("income-edit").click();
  await card.getByTestId("income-remove").nth(1).click();
  await card.getByTestId("income-cancel").click();
  await expect(card.getByTestId("income-line")).toHaveCount(2);
  await page.reload();
  await expect(card.getByTestId("income-total")).toContainText("$334.00");
});
