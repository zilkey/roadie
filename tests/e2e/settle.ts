import { expect, type Locator } from "@playwright/test";

/**
 * The element's box once it has stopped moving. A page still filling in (data arriving above it, a panel taking its
 * saved width) moves things after they are visible, and a drag aimed at a box measured before that lands somewhere
 * else (tours.spec: a drop meant for one day landed on the day above). Waits for a few samples in a row to agree.
 */
export async function settledBox(el: Locator) {
  let last = "";
  await expect(async () => {
    const b = await el.boundingBox();
    const now = JSON.stringify(b);
    const same = b !== null && now === last;
    last = now;
    expect(same).toBeTruthy();
  }).toPass({ intervals: [150, 150, 150, 300, 300], timeout: 10_000 });
  return (await el.boundingBox())!;
}
