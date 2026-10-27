import { test, expect } from "@playwright/test";
import { A } from "./env";

const stamp = Date.now().toString(36);

test("an admin invites two people from the sign-up flow; a duplicate email is flagged and the rest still go in", async ({ page }) => {
  await page.goto("/signin");
  await page.getByTestId("dev-jeff").click();
  await expect(page).toHaveURL(/\/calendar$/);
  await page.goto(A("/welcome/people"));
  await expect(page.getByTestId("welcome-people")).toBeVisible();
  await expect(page.getByTestId("welcome-people")).toContainText("They sign in with Google using this email.");
  await expect(page.getByTestId("invite-add")).toBeDisabled();

  // a half-filled row is refused under its fields
  await page.getByTestId("invite-name-0").fill(`Robin ${stamp}`);
  await page.getByTestId("invite-add").click();
  await expect(page.getByTestId("invite-row-0").getByTestId("error-email")).toBeVisible();
  await expect(page).toHaveURL(/\/welcome\/people$/);

  await page.getByTestId("invite-email-0").fill(`robin-${stamp}@example.com`);
  await page.getByTestId("invite-instruments-0").fill("fiddle, vocals");
  await page.getByTestId("invite-name-1").fill(`Quinn ${stamp}`);
  await page.getByTestId("invite-role-1").selectOption("admin");
  await page.getByTestId("invite-email-1").fill(`quinn-${stamp}@example.com`);
  await page.getByTestId("invite-more").click();
  await expect(page.getByTestId("invite-add")).toHaveText("Add 2 people");
  await page.getByTestId("invite-add").click();

  await expect(page).toHaveURL(/\/welcome\/links$/);
  await page.goto(A("/admin/people"));
  await expect(page.getByTestId(`person-row-robin-${stamp}@example.com`)).toBeVisible();
  await expect(page.getByTestId(`person-row-quinn-${stamp}@example.com`)).toBeVisible();

  // duplicate: jeff@example.com is already in the band
  await page.goto(A("/welcome/people"));
  await page.getByTestId("invite-name-0").fill("Jeff again");
  await page.getByTestId("invite-email-0").fill("jeff@example.com");
  await page.getByTestId("invite-name-1").fill(`Sam ${stamp}`);
  await page.getByTestId("invite-email-1").fill(`sam-${stamp}@example.com`);
  await page.getByTestId("invite-add").click();
  await expect(page.getByTestId("invite-row-0").getByTestId("error-email")).toHaveText("Already in the band");
  await expect(page.getByTestId("invite-continue")).toBeVisible();
  await page.goto(A("/admin/people"));
  await expect(page.getByTestId(`person-row-sam-${stamp}@example.com`)).toBeVisible();

  // Skip goes back to Ready and creates nothing
  await page.goto(A("/welcome/people"));
  await page.getByTestId("invite-name-0").fill("Nobody");
  await page.getByTestId("invite-skip").click();
  await expect(page).toHaveURL(/\/welcome$/);
});
