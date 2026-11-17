import { test, expect, type APIRequestContext } from "@playwright/test";
import { FIRESTORE } from "./env";

/** platform/config.signUpOpen, written as the emulator's owner (no client may write it; scripts/platform-config.ts does in prod). */
async function setSignUp(api: APIRequestContext, open: boolean) {
  const res = await api.patch(`http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents/platform/config`, {
    headers: { authorization: "Bearer owner" }, data: { fields: { signUpOpen: { booleanValue: open } } },
  });
  expect(res.ok()).toBe(true);
}

// The browser says New York: the form's time zone starts there, whatever machine runs this.
test.use({ timezoneId: "America/New_York" });

// The dev "stranger" (stranger@example.com) is a Google account on no band's list. This is the only spec that signs in as
// them: starting a band changes who they are, so it all happens in one test.
test("a stranger signs in, starts a band, and ends up its admin", async ({ page, request }) => {
  // Sign-up is closed until platform/config opens it; the seed has no such doc. Opened below, closed again at the end.
  await setSignUp(request, false);
  await page.goto("/signin");
  await page.getByTestId("dev-stranger").click();

  // No band yet: stays signed in, no dead end
  await expect(page).toHaveURL(/\/no-band$/);
  await expect(page.getByTestId("no-band-email")).toHaveText("stranger@example.com");
  await expect(page.getByTestId("no-band")).not.toContainText("Ask Rudy");
  await page.goto("/artists/someone-elses-band/calendar"); // band pages send them back here
  await expect(page).toHaveURL(/\/no-band$/);
  await page.getByTestId("check-again").click();
  await expect(page.getByTestId("still-no-band")).toBeVisible();

  // Name your band: nothing is created until Start a band
  await page.getByTestId("start-band").click();
  await expect(page).toHaveURL(/\/start-band$/);
  await page.getByTestId("create-band").click();
  await expect(page.getByTestId("band-name-error")).toBeVisible();
  await page.getByTestId("band-name").fill("The Night Owls");
  await expect(page.getByTestId("band-slug-preview")).toHaveText("the-night-owls");
  // closed: the form says so and nothing is made
  await page.getByTestId("create-band").click();
  await expect(page.getByTestId("error")).toHaveText("Roadie is invite-only for now. Ask your band's admin to add you.");
  await expect(page).toHaveURL(/\/start-band$/);
  await setSignUp(request, true);
  // a taken slug is refused under the field (the seeded band already has this one)
  await page.getByTestId("slug-change").click();
  await page.getByTestId("band-slug").fill("nora-quill-band");
  await page.getByTestId("create-band").click();
  await expect(page.getByTestId("band-slug-error")).toHaveText("Already taken");
  await page.getByTestId("band-slug").fill("the-night-owls");
  await page.getByTestId("band-play").fill("guitar, vocals");
  // the time zone starts as the browser's; they pick Central
  await expect(page.getByTestId("band-time-zone")).toHaveValue("America/New_York");
  await page.getByTestId("band-time-zone").selectOption("America/Chicago");
  await page.getByTestId("create-band").click();

  // Ready, then the app
  await expect(page).toHaveURL(/\/artists\/the-night-owls\/welcome$/);
  await expect(page.getByTestId("page-title")).toHaveText("The Night Owls is ready");
  await expect(page.getByTestId("setup-rows").locator("li")).toHaveCount(3);
  for (const id of ["people", "links", "google"]) await expect(page.getByTestId(`setup-${id}`)).toHaveAttribute("data-done", "false");
  await page.getByTestId("go-to-app").click();
  await expect(page).toHaveURL(/\/artists\/the-night-owls\/calendar$/);

  // Home asks them to finish setting up: three rows, none done. Dismiss hides it for good.
  const card = page.getByTestId("finish-setup");
  await expect(card).toContainText("Finish setting up The Night Owls");
  await expect(card.getByTestId("setup-rows").locator("li")).toHaveCount(3);
  for (const id of ["people", "links", "google"]) await expect(card.getByTestId(`setup-${id}`)).toHaveAttribute("data-done", "false");
  await page.getByTestId("finish-setup-dismiss").click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("calendar-page")).toBeVisible();
  await expect(page.getByTestId("finish-setup")).toHaveCount(0);

  // they are the band's first admin
  await page.goto("/artists/the-night-owls/admin/people");
  await expect(page.getByTestId("page-title")).toHaveText("People");
  const row = page.getByTestId("person-row-stranger@example.com");
  await expect(row).toBeVisible();
  await expect(row.locator(".chip").first()).toHaveText("Admin");
  // and the band's time zone is the one they picked
  await page.goto("/artists/the-night-owls/admin/artist");
  await expect(page.getByTestId("artist-time-zone")).toHaveValue("America/Chicago");
  await setSignUp(request, false);
});
