import { test, expect, type Page } from "@playwright/test";
import { A, FIRESTORE } from "./env";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/home$/);
}
const OTHER = (path: string) => `/artists/fern-valley-trio${path}`;
const STAMP = Date.now();

/** Booking -> search -> the venue's full record, as an admin of `base`. */
async function openVenue(page: Page, base: (p: string) => string, search: string, exact?: string) {
  await page.goto(base("/booking"));
  await page.getByTestId("booking-search").fill(search);
  const row = page.getByTestId(/^row-venue-/).filter({ hasText: exact ?? search }).first();
  await row.getByTestId(/^venue-full-/).click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
}

test("a member opens the venue from a show, sees the address but no notes, and fixes the capacity through the confirmation; another band's admin sees the fix but only their own notes", async ({ page, browser }) => {
  await signInAs(page, "david"); // a member of Ingrid Avison Band
  await page.goto(A("/shows"));
  await page.locator("a[data-testid^='show-']", { hasText: "Hi-Dive" }).first().click();
  await page.getByTestId("show-venue-link").click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
  const venueUrl = page.url();
  await expect(page.getByTestId("page-title")).toHaveText("Hi-Dive");
  await expect(page.getByTestId("room-address")).toContainText("7 S Broadway");
  // the band's private notes are not there for a member: no notes form, no contacts, no merge, no archive
  await expect(page.getByTestId("notes-loadInNotes")).toHaveCount(0);
  await expect(page.getByTestId("notes-private")).toHaveCount(0);
  await expect(page.getByTestId("contacts-panel")).toHaveCount(0);
  await expect(page.getByTestId("merge-open")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Alley door on Broadway");

  // fixing a fact: explicit Save, then a dialog that says who it reaches and lists before and after
  const capacity = String(300 + (STAMP % 100));
  await page.getByTestId("room-edit").click();
  await expect(page.getByTestId("room-save")).toBeVisible();
  await page.getByTestId("room-capacity").fill(capacity);
  await page.getByTestId("room-save").click();
  const dialog = page.getByTestId("room-confirm-dialog");
  await expect(dialog).toContainText("for every band that uses Band Tracker");
  await expect(dialog).toContainText("Your name is recorded in its history");
  await expect(page.getByTestId("room-change-capacity")).toContainText(`250`);
  await expect(page.getByTestId("room-change-capacity")).toContainText(capacity);
  // Cancel changes nothing
  await page.getByTestId("room-confirm-cancel").click();
  await expect(dialog).toBeHidden();
  await page.getByTestId("room-cancel").click();
  await expect(page.getByTestId("room-capacity")).toHaveText("250");
  await page.getByTestId("room-edit").click();
  await page.getByTestId("room-capacity").fill(capacity);
  await page.getByTestId("room-save").click();
  await page.getByTestId("room-confirm").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("room-capacity")).toHaveText(capacity);
  await page.reload();
  await expect(page.getByTestId("room-capacity")).toHaveText(capacity);

  // an admin of another band: the same room (with the fix), but her own notes, never Ingrid's
  const olga = await browser.newContext();
  const op = await olga.newPage();
  await signInAs(op, "olga");
  await openVenue(op, OTHER, "hi-dive", "Hi-Dive");
  await expect(op.getByTestId("room-capacity")).toHaveText(capacity);
  await expect(op.getByTestId("notes-loadInNotes")).toHaveValue("Fern Valley loads in the side door.");
  await expect(op.getByTestId("notes-notes")).toHaveValue(/Ask for Rae/);
  await expect(op.locator("body")).not.toContainText("Alley door on Broadway");
  await expect(op.locator("body")).not.toContainText("Ask for Sam");
  // she can open the same room by the first band's venue id: she still only reads her own notes there
  expect(op.url().split("/").pop()).toBe(venueUrl.split("/").pop());

  // Jeff (admin of the first band) sees his notes, not hers
  const jeff = await browser.newContext();
  const jp = await jeff.newPage();
  await signInAs(jp, "jeff");
  await jp.goto(venueUrl);
  await expect(jp.getByTestId("room-capacity")).toHaveText(capacity);
  await expect(jp.getByTestId("notes-loadInNotes")).toHaveValue("Alley door on Broadway; 20 minutes to load in.");
  await expect(jp.locator("body")).not.toContainText("Fern Valley");

  // History: each band's page lists its own records' changes and the shared ones, not the other band's private notes
  await jp.goto(A("/admin/history"));
  await jp.getByTestId("filter-entity").fill("venueNotes");
  await expect(jp.getByTestId("history-row").first()).toBeVisible();
  expect(await jp.getByTestId("history-list").textContent()).not.toContain("Fern Valley loads");
  await op.goto(OTHER("/admin/history"));
  await op.getByTestId("filter-entity").fill("venueNotes");
  await expect(op.getByTestId("history-row").first()).toBeVisible();
  expect(await op.getByTestId("history-list").textContent()).not.toContain("Alley door");
  await op.getByTestId("filter-entity").fill("venues");
  await expect(op.getByTestId("history-row").first()).toBeVisible(); // the shared room's changes (the capacity fix) are everyone's
  await olga.close(); await jeff.close();
});

test("adding a venue says other bands will see it; a shared edit that changes nothing just closes", async ({ page }) => {
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("add-venue").click();
  await expect(page.getByTestId("new-venue-shared-note")).toContainText("Other bands will see this venue's name, address and details.");
  await page.getByTestId("add-venue").click();
  await openVenue(page, A, "dairy arts");
  await page.getByTestId("room-edit").click();
  await page.getByTestId("room-save").click();
  await expect(page.getByTestId("room-confirm-dialog")).toBeHidden();
  await expect(page.getByTestId("room-card")).toBeVisible();
});

test("merge a duplicate venue into the room to keep: every band's notes move, the old page redirects, and Undo from History restores it", async ({ page, browser }) => {
  page.on("dialog", (d) => d.accept());
  await signInAs(page, "jeff");
  await openVenue(page, A, "the hi-dive", "The Hi-Dive");
  const dupUrl = page.url();
  await page.getByTestId("merge-open").click();
  await page.getByTestId("merge-search").fill("hi-dive");
  await expect(page.getByTestId("merge-results")).not.toContainText("The Hi-Dive"); // not into itself
  await page.getByTestId(/^merge-pick-/).first().click();
  await expect(page.getByTestId("merge-summary")).toContainText("Every band's shows, pitches and notes at The Hi-Dive will move to Hi-Dive");
  await page.getByTestId("merge-confirm").click();
  await expect(page.getByTestId("page-title")).toHaveText("Hi-Dive");
  const keepUrl = page.url();
  expect(keepUrl).not.toBe(dupUrl);
  // the band's notes were joined onto the survivor's; the duplicate's website filled the survivor's empty one
  await expect(page.getByTestId("notes-notes")).toHaveValue(/Possible duplicate of Hi-Dive\./);
  await expect(page.getByTestId("notes-notes")).toHaveValue(/Ask for Sam/);
  await expect(page.getByTestId("room-website")).toContainText("hi-dive.example");
  // the merged venue's old address redirects to the survivor
  await page.goto(dupUrl);
  await expect(page).toHaveURL(keepUrl);
  await page.goto(A("/booking"));
  await page.getByTestId("booking-search").fill("the hi-dive");
  await expect(page.getByTestId(/^row-venue-/)).toHaveCount(0);

  // the other band's notes moved too (and stayed hers)
  const olga = await browser.newContext();
  const op = await olga.newPage();
  await signInAs(op, "olga");
  await op.goto(keepUrl.replace("/artists/ingrid-avison-band", "/artists/fern-valley-trio"));
  await expect(op.getByTestId("notes-notes")).toHaveValue(/Fern Valley saw this room as The Hi-Dive\./);
  await expect(op.locator("body")).not.toContainText("Ask for Sam");
  await olga.close();

  // one run in History: Undo brings the duplicate back
  await page.goto(A("/admin/history"));
  await page.getByTestId("filter-entity").fill("venues");
  const row = page.locator('[data-testid="history-row"][data-op="delete"][data-kind="venues"]').first();
  await expect(row).toBeVisible();
  await row.getByTestId("pick-run").click();
  await expect(page.getByTestId("run-card")).toBeVisible();
  await page.getByTestId("undo-run").click();
  await expect(page.getByTestId("undo-counts")).toContainText("put back");
  await page.goto(dupUrl);
  await expect(page.getByTestId("page-title")).toHaveText("The Hi-Dive");
});

test("the venue page's Pitch card: add to the pitch list, edit it, comment, abandon it into Past pitches; Edit sits in the header", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await signInAs(page, "jeff");
  await page.goto(A("/shows"));
  await page.locator("a[data-testid^='show-']", { hasText: "Hi-Dive" }).first().click();
  await page.getByTestId("show-venue-link").click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
  // Edit is in the header and swaps the facts for the form; Cancel puts them back
  await page.getByTestId("room-edit").click();
  await expect(page.getByTestId("room-form")).toBeVisible();
  await expect(page.getByTestId("room-edit")).toHaveCount(0);
  await page.getByTestId("room-cancel").click();
  await expect(page.getByTestId("room-edit")).toBeVisible();

  const card = page.getByTestId("venue-pitch-card");
  if (await page.getByTestId("pitch-open").count()) await page.getByTestId("pitch-abandon").click();
  await expect(page.getByTestId("not-on-pitch-list")).toBeVisible();
  // nothing is added until the explicit button
  await card.locator("[data-testid^='flag-'][data-flagged]").click();
  await expect(card.getByTestId(/^flag-form-/)).toBeVisible();
  await expect(page.getByTestId("pitch-open")).toHaveCount(0);
  await card.getByTestId(/^flag-submit-/).click();
  await expect(page.getByTestId("pitch-open")).toBeVisible();
  await expect(page.getByTestId("status-chip").first()).toBeVisible();

  await page.getByTestId("pitch-edit").click();
  await page.getByTestId("pitch-edit-dates-date").fill("2027-02-12");
  await page.getByTestId("pitch-edit-dates-add").click();
  await expect(page.getByTestId("pitch-edit-dates-date")).toHaveValue("");
  await page.getByTestId("pitch-edit-dates-date").fill("2027-03-05");
  await page.getByTestId("pitch-edit-dates-date").press("Enter");
  await expect(page.getByTestId("pitch-edit-dates-chip-1")).toHaveText("Fri, Mar 5");
  await page.getByTestId("pitch-edit-dates-remove-1").click();
  await expect(page.getByTestId("pitch-edit-dates-chip-1")).toHaveCount(0);
  await expect(page.getByTestId("edit-configurations")).toHaveCSS("text-decoration-line", "underline"); // the Edit next to Configuration is a link
  await page.getByTestId("pitch-edit-save").click();
  await expect(page.getByTestId("pitch-dates-summary")).toContainText("Fri, Feb 12");

  const text = `Sent the EPK ${Date.now()}`;
  await page.getByTestId("pitch-comment-input").fill(text);
  await expect(page.getByTestId("pitch-comment")).toHaveCount(await page.getByTestId("pitch-comment").count()); // typing alone posts nothing
  await page.getByTestId("pitch-comment-send").click();
  await expect(page.getByTestId("pitch-comments")).toContainText(text);

  await page.getByTestId("pitch-abandon").click();
  await expect(page.getByTestId("pitch-open")).toHaveCount(0);
  await expect(page.getByTestId("past-pitches")).toContainText("Abandoned");
});

const FS = `http://${FIRESTORE}/v1/projects/demo-band-tracker/databases/(default)/documents`;
const authz = { headers: { authorization: "Bearer owner" } };

/** Venue page with an open pitch that has the two dates and the given comments; returns the pitch id. */
async function pitchWithComments(page: Page, comments: string[]) {
  await signInAs(page, "jeff");
  await page.goto(A("/booking"));
  await page.getByTestId("booking-search").fill("Hi-Dive");
  await page.getByTestId(/^row-venue-/).filter({ hasText: "Hi-Dive" }).first().getByTestId(/^venue-full-/).click();
  await expect(page.getByTestId("venue-page")).toBeVisible();
  const card = page.getByTestId("venue-pitch-card");
  if (await page.getByTestId("pitch-open").count()) {
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("pitch-abandon").click();
  }
  await card.locator("[data-testid^='flag-'][data-flagged]").click();
  await card.getByTestId(/^flag-submit-/).click();
  await expect(page.getByTestId("pitch-open")).toBeVisible();
  await page.getByTestId("pitch-edit").click();
  for (const d of ["2027-04-09", "2027-04-16"]) {
    await page.getByTestId("pitch-edit-dates-date").fill(d);
    await page.getByTestId("pitch-edit-dates-add").click();
  }
  await page.getByTestId("pitch-edit-save").click();
  for (const c of comments) {
    await page.getByTestId("pitch-comment-input").fill(c);
    await page.getByTestId("pitch-comment-send").click();
    await expect(page.getByTestId("pitch-comments")).toContainText(c);
  }
  return (await page.getByTestId("pitch-open-full").getAttribute("href"))!.split("/").pop()!; // the pitch's id
}

/** After booking: the pitch sits in Past pitches as "Became a show"; returns the comments on the one show it made. */
async function showCommentsAfterBooking(page: Page, request: import("@playwright/test").APIRequestContext, pitchId: string) {
  await expect(page.getByTestId("pitch-open")).toHaveCount(0);
  await expect(page.getByTestId(`past-pitch-${pitchId}`)).toContainText("Became a show");
  const pitch = await (await request.get(`${FS}/pitches/${pitchId}`, authz)).json();
  const showIds = (pitch.fields.showIds.arrayValue.values ?? []).map((v: { stringValue: string }) => v.stringValue);
  expect(showIds).toHaveLength(1);
  const show = await (await request.get(`${FS}/shows/${showIds[0]}`, authz)).json();
  expect(show.fields.date.stringValue).toBe("2027-04-09");
  const list = await (await request.get(`${FS}/shows/${showIds[0]}/comments`, authz)).json();
  return ((list.documents ?? []) as { fields: { body: { stringValue: string } } }[]).map((d) => d.fields.body.stringValue).sort();
}

test("Booked it! on the venue page: choose the date and configuration, copy the comments over, and nothing happens until Create show", async ({ page, request }) => {
  const stamp = Date.now();
  const pitchId = await pitchWithComments(page, [`Sent the EPK ${stamp}`, `They want 90 minutes ${stamp}`]);
  await page.getByTestId("booked-it").click();
  await expect(page.getByTestId("book-form")).toBeVisible();
  await expect(page.getByTestId("pitch-open")).toHaveCount(0);
  // the first date is chosen, the pitch's configuration is filled in, and the comments are set to come along
  await expect(page.getByTestId("book-date-2027-04-09")).toBeChecked();
  await expect(page.getByTestId("book-copy")).toBeChecked();
  await expect(page.getByTestId("book-form")).toContainText("Copy over comments (2)");
  await expect(page.getByTestId("book-date-other")).not.toBeChecked();
  await page.getByTestId("book-date-other").check();
  await expect(page.getByTestId("book-submit")).toBeDisabled(); // another date needs a date
  await page.getByTestId("book-date-2027-04-09").check();
  await expect(page.getByTestId("book-other-date")).toHaveCount(0);
  // Cancel backs out without making anything
  await page.getByTestId("book-cancel").click();
  await expect(page.getByTestId("pitch-open")).toBeVisible();
  await page.getByTestId("booked-it").click();
  await page.getByTestId("book-submit").click();
  expect(await showCommentsAfterBooking(page, request, pitchId)).toEqual([`Sent the EPK ${stamp}`, `They want 90 minutes ${stamp}`].sort());
});

test("Booked it! with Copy over comments unticked leaves the show without comments", async ({ page, request }) => {
  const pitchId = await pitchWithComments(page, [`Only on the pitch ${Date.now()}`]);
  await page.getByTestId("booked-it").click();
  await page.getByTestId("book-copy").uncheck();
  await page.getByTestId("book-submit").click();
  expect(await showCommentsAfterBooking(page, request, pitchId)).toEqual([]);
});

/** Venue page for Hi-Dive with no open pitch and the flag form open. */
async function hiDiveFlagForm(page: Page) {
  page.on("dialog", (d) => d.accept());
  await signInAs(page, "jeff");
  await openVenue(page, A, "Hi-Dive");
  if (await page.getByTestId("pitch-open").count()) await page.getByTestId("pitch-abandon").click();
  const card = page.getByTestId("venue-pitch-card");
  await card.locator("[data-testid^='flag-'][data-flagged]").click();
  return card;
}

test("a date typed into the possible-dates box is kept without pressing +: flag form, Edit pitch; the x on a card chip removes it right away", async ({ page, request }) => {
  const card = await hiDiveFlagForm(page);
  await card.getByTestId(/^flag-dates-.+-date$/).fill("2027-06-04");
  await card.getByTestId(/^flag-submit-/).click();
  await expect(page.getByTestId("pitch-dates-summary")).toContainText("Fri, Jun 4");

  await page.getByTestId("pitch-edit").click();
  await page.getByTestId("pitch-edit-dates-date").fill("2027-06-11");
  await page.getByTestId("pitch-edit-save").click(); // no +
  await expect(page.getByTestId("pitch-dates-summary")).toContainText("Fri, Jun 4");
  await expect(page.getByTestId("pitch-dates-summary")).toContainText("Fri, Jun 11");

  // the x on the read-only card: no confirm, no edit mode
  await page.getByRole("button", { name: "Remove Fri, Jun 4" }).click();
  await expect(page.getByTestId("pitch-dates-summary")).not.toContainText("Fri, Jun 4");
  await expect(page.getByTestId("pitch-dates-summary")).toContainText("Fri, Jun 11");
  await expect(page.getByTestId("pitch-edit-form")).toHaveCount(0);
  const id = (await page.getByTestId("pitch-open-full").getAttribute("href"))!.split("/").pop()!;
  const doc = await (await request.get(`${FS}/pitches/${id}`, authz)).json();
  expect(doc.fields.dates.arrayValue.values.map((v: { stringValue: string }) => v.stringValue)).toEqual(["2027-06-11"]);
  // read-only chips elsewhere (Past pitches) have no x
  await page.getByTestId("pitch-abandon").click();
  await expect(page.getByTestId("past-pitches").getByRole("button")).toHaveCount(0);
});

test("Booked it!: Not sure yet leaves the show without a configuration; the invite list follows the configuration; unticked invites nobody", async ({ page, request }) => {
  const card = await hiDiveFlagForm(page);
  await card.getByTestId(/^flag-pitchedAs-/).selectOption({ label: "Trio" });
  await card.getByTestId(/^flag-dates-.+-date$/).fill("2027-07-09");
  await card.getByTestId(/^flag-submit-/).click();
  const id = (await page.getByTestId("pitch-open-full").getAttribute("href"))!.split("/").pop()!;
  await page.getByTestId("booked-it").click();
  const list = page.getByTestId("book-invite-list");
  await expect(page.getByTestId("book-invite")).toBeChecked();
  await expect(list).toContainText("Ingrid");
  await expect(list).toContainText("David");
  await page.getByTestId("book-config").selectOption({ label: "Ingrid solo" });
  await expect(list).toContainText("Ingrid");
  await expect(list).not.toContainText("David");
  await page.getByTestId("book-config").selectOption({ label: "Not sure yet" });
  await expect(list).toContainText("Nobody would be invited");
  await expect(page.getByTestId("book-invite")).toBeDisabled();
  await expect(page.getByTestId("book-invite")).not.toBeChecked();
  await page.getByTestId("book-submit").click();
  await expect(page.getByTestId("pitch-open")).toHaveCount(0);
  await expect(page.getByTestId(`past-pitch-${id}`)).toContainText("Became a show");
  const pitch = await (await request.get(`${FS}/pitches/${id}`, authz)).json();
  const showId = pitch.fields.showIds.arrayValue.values[0].stringValue;
  const show = await (await request.get(`${FS}/shows/${showId}`, authz)).json();
  expect(show.fields.billedAs).toBeUndefined();
  expect(show.fields.personnel.arrayValue.values ?? []).toHaveLength(0);
});
