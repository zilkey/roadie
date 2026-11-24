import { test, expect, type Page } from "@playwright/test";
import { A, openTab } from "./env";
import { day } from "./dates";
import { settledBox } from "./settle";
import { pngWithText } from "../fixtures/png-text";

async function signInAs(page: Page, key: string) {
  await page.goto("/signin");
  await page.getByTestId(`dev-${key}`).click();
  await expect(page).toHaveURL(/\/calendar$/);
}
async function ask(page: Page, text: string) {
  await page.getByTestId("roadie-input").fill(text);
  await page.getByTestId("roadie-input").press("Enter");
}

// What Roadie says and does for each kind of message is tests/emulator/roadie*.test.ts (the canned model is deterministic):
// replies and off-topic lines, ui.ask and its buttons, confirm cards and their dropdown, the web search link, Stop. The tests
// here are what only a browser shows: the panel, its resize, tools landing on live pages, and the confirm and Stop buttons.
test("admin: panel on the right, canned reply, survives navigation and reload", async ({ page }) => {
  await signInAs(page, "nora");
  const panel = page.getByTestId("roadie-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("roadie-input")).toHaveAttribute("placeholder", "Ask or tell me anything…");

  await page.getByTestId("roadie-new").click();
  await ask(page, "hi");
  await expect(page.getByTestId("roadie-msg-assistant")).toContainText("Roadie here");
  await expect(page.getByTestId("roadie-msg-user")).toHaveText("hi");

  await ask(page, "show me the shows");
  await expect(page).toHaveURL(/\/shows$/);
  await expect(page.getByTestId("roadie-action")).toHaveText("→ Opened Shows");

  await page.getByTestId("tab-songs").click(); // the panel (and chat) stay put
  await expect(page).toHaveURL(/\/songs$/);
  await expect(page.getByTestId("roadie-msg-user")).toHaveCount(2); // the chat stays put across navigation

  await page.reload();
  await expect(page.getByTestId("roadie-msg-user")).toHaveCount(2);
  await expect(page.getByTestId("roadie-msg-assistant").first()).toContainText("Roadie here");
});


test("admin: drag or arrow-key the panel's edge; the width is saved, clamped to half the window, and snaps to the rail", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAs(page, "nora");
  const panel = page.getByTestId("roadie-panel");
  const handle = page.getByTestId("roadie-resize");
  await expect(handle).toHaveAttribute("role", "separator");
  // (The width is saved per person and a retry meets what the first attempt left: nothing here assumes the starting width.)
  await expect(handle).toHaveAttribute("aria-valuemin", "280");
  await expect(handle).toHaveAttribute("aria-valuemax", "640");

  // Drag the left edge out to 500px.
  // Wait until the save of the width we mean has landed, not just any width (a drag can save on the way), and not just
  // sent: a reload straight after the request goes out can beat the write.
  const saved = (width: number) => page.waitForResponse((r) => r.url().includes("assistant.setPrefs") && r.request().method() === "POST" && (r.request().postDataJSON() ?? {}).width === width && r.ok());
  let req = saved(500);
  const h = await settledBox(handle);
  await page.mouse.move(h.x + h.width / 2, h.y + 200);
  await page.mouse.down();
  await page.mouse.move(1280 - 450, h.y + 200, { steps: 4 });
  await page.mouse.move(1280 - 500, h.y + 200, { steps: 4 });
  await page.mouse.up();
  await req;
  await expect(panel).toHaveAttribute("data-width", "500");

  // Arrow keys: left widens, right narrows; Home goes to the minimum.
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "516");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "484");

  // Saved per person: it comes back after a reload.
  req = saved(640);
  await page.keyboard.press("End");
  await req;
  await page.reload();
  await expect(panel).toHaveAttribute("data-width", "640");

  // A smaller window shows it at half the window.
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(panel).toHaveAttribute("data-width", "500");
  await expect(handle).toHaveAttribute("aria-valuemax", "500");

  // Drag under 280px: it snaps to the rail; Expand brings back the last width.
  const g = await settledBox(handle);
  await page.mouse.move(g.x + g.width / 2, g.y + 200);
  await page.mouse.down();
  await page.mouse.move(1000 - 200, g.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect(panel).toHaveAttribute("data-width", "narrow");
  await page.getByTestId("roadie-expand").click();
  await expect(panel).toHaveAttribute("data-width", "500");

  // Leave the width at the default (360) for the specs after this one.
  await page.setViewportSize({ width: 1280, height: 800 });
  req = saved(360);
  const k = await settledBox(handle);
  await page.mouse.move(k.x + k.width / 2, k.y + 200);
  await page.mouse.down();
  await page.mouse.move(1280 - 400, k.y + 200, { steps: 4 });
  await page.mouse.move(1280 - 360, k.y + 200, { steps: 4 });
  await page.mouse.up();
  await req;
  await expect(panel).toHaveAttribute("data-width", "360");
});

const STAMP = Date.now();

test("'add $50 gas': read-back line, the expense appears on Money live, Undo removes it", async ({ page }) => {
  await signInAs(page, "nora");
  await page.getByTestId("roadie-new").click();
  await openTab(page, "money");
  await expect(page).toHaveURL(/\/money$/);
  const what = `gas ${STAMP}`;
  await ask(page, `add $50 ${what}`);
  await expect(page.getByTestId("roadie-readback")).toContainText(`Logged $50 ${what}, paid by`);
  await expect(page.locator("main").getByText(what).first()).toBeVisible(); // the Money page updated by itself, no reload
  await page.getByTestId("roadie-undo").click();
  await expect(page.getByTestId("roadie-undone")).toBeVisible();
  await expect(page.locator("main").getByText(what)).toHaveCount(0);
});

test("'cancel the show': confirm card, Cancel leaves it, Yes cancels it", async ({ page }) => {
  await signInAs(page, "nora");
  // a show of its own, so the seeded ones stay as they are
  await page.goto(A("/shows/new"));
  await page.getByTestId("show-venue").selectOption({ label: "Swallow Hill Music · Denver" });
  await page.getByTestId("show-date").fill(day(300));
  await page.getByTestId("show-loadIn").fill("17:00");
  await page.getByTestId("show-set").fill("20:00");
  await page.getByTestId("billed-as").selectOption("full-band");
  await page.getByTestId("show-save").click();
  await expect(page.getByTestId("show-page")).toBeVisible();
  const status = page.getByTestId("show-status");
  await expect(status).not.toHaveText("Canceled");

  await page.getByTestId("roadie-new").click();
  await ask(page, "cancel the show");
  const card = page.getByTestId("roadie-confirm").last();
  await expect(card).toContainText("Cancel the show");
  await expect(card).toContainText("Swallow Hill Music");
  await expect(card).toHaveAttribute("data-status", "pending");
  await expect(status).not.toHaveText("Canceled"); // asking first: nothing happened yet
  await card.getByTestId("roadie-confirm-cancel").click();
  await expect(card).toHaveAttribute("data-status", "canceled");
  await expect(status).not.toHaveText("Canceled");

  await ask(page, "cancel the show");
  const second = page.getByTestId("roadie-confirm").last();
  await expect(second).toHaveAttribute("data-status", "pending");
  await second.getByTestId("roadie-confirm-yes").click();
  await expect(second).toHaveAttribute("data-status", "done");
  await expect(status).toHaveText("Canceled");
  await expect(page.getByTestId("roadie-readback").last()).toContainText("Canceled the show");
});

test("Stop: while Roadie works, Send becomes Stop; tapping it ends the reply, marks it Stopped, and the chat carries on", async ({ page }) => {
  await signInAs(page, "nora");
  await page.getByTestId("roadie-new").click();
  // Sent (the message and the Stop leave the browser as keepalive requests, so a reload after this can't lose them).
  const sent = (path: string) => page.waitForRequest((r) => r.url().endsWith(`/api/assistant/${path}`) && r.method() === "POST");
  // The Stop is awaited until the server has answered it: the reload below can cut it off while the dev server is still
  // compiling the route (its first call in this shard), and then the slow fake reply runs its full 20 seconds.
  const chat = sent("chat"), stopped = page.waitForResponse((r) => r.url().endsWith("/api/assistant/stop") && r.request().method() === "POST");
  await ask(page, "find me a venue in Boise [fake: slow]");
  await expect(page.getByTestId("roadie-vamp")).toBeVisible();
  await expect(page.getByTestId("roadie-send")).toHaveCount(0);
  await page.getByTestId("roadie-stop").click();
  await chat;
  await stopped;

  await expect(page.getByTestId("roadie-stopped")).toBeVisible();
  await expect(page.getByTestId("roadie-stop")).toHaveCount(0);
  await expect(page.getByTestId("roadie-vamp")).toHaveCount(0);
  // The saved copy (marked stopped on the server) survives a reload. The server saves it once it has the Stop,
  // a beat after the click: reload until it is there instead of once, straight away.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("roadie-msg-user")).toHaveText("find me a venue in Boise [fake: slow]", { timeout: 3000 });
    await expect(page.getByTestId("roadie-stopped")).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 25_000, intervals: [500, 1000, 2000] });

  await ask(page, "hi");
  await expect(page.getByTestId("roadie-msg-assistant").last()).toContainText("Roadie here");
  await expect(page.getByTestId("roadie-stopped")).toHaveCount(1);
});

// The emulators' fake reader returns a PNG's `ocr` text chunk as the image's words (src/server/assistant/readImage.ts).
test("image: paste, drop or pick one, and its words land in the message box to edit and send", async ({ page }) => {
  await signInAs(page, "nora");
  await page.getByTestId("roadie-new").click();
  const input = page.getByTestId("roadie-input");
  const b64 = (text: string) => pngWithText(text).toString("base64");

  // Paste a screenshot into an empty box.
  await input.focus();
  await input.evaluate((el, data) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], "shot.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, b64("Fri Dec 5\nThe Grand, 8pm"));
  await expect(input).toHaveValue("Fri Dec 5\nThe Grand, 8pm");

  // Pick one with the photo button: added after what's already there.
  await input.fill("add this show:");
  await page.getByTestId("roadie-photo-input").setInputFiles({ name: "flyer.png", mimeType: "image/png", buffer: pngWithText("Doors 7pm") });
  await expect(input).toHaveValue("add this show:\n\nDoors 7pm");

  // Drop one on the panel.
  await input.fill("");
  const dt = await page.evaluateHandle((data) => {
    const d = new DataTransfer();
    d.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], "drop.png", { type: "image/png" }));
    return d;
  }, b64("Setlist: Ramble On"));
  await page.getByTestId("roadie-chat").dispatchEvent("dragover", { dataTransfer: dt });
  await page.getByTestId("roadie-chat").dispatchEvent("drop", { dataTransfer: dt });
  await expect(input).toHaveValue("Setlist: Ramble On");

  // No words: a note, and the box is left alone.
  await page.getByTestId("roadie-photo-input").setInputFiles({ name: "blank.png", mimeType: "image/png", buffer: pngWithText("", "Comment") });
  await expect(page.getByTestId("roadie-image-error")).toHaveText("I couldn't find any words in that image.");
  await expect(input).toHaveValue("Setlist: Ramble On");

  // Nothing is sent until the person sends it.
  await expect(page.getByTestId("roadie-msg-user")).toHaveCount(0);
  await input.press("Enter");
  await expect(page.getByTestId("roadie-msg-user")).toHaveText("Setlist: Ramble On");
});
