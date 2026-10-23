/** Starts all five fakes in one process. `tsx fakes/run-all.ts` */
import { fakeGmail } from "./fake-gmail/server";
import { fakeDrive } from "./fake-drive/server";
import { fakeCalendar } from "./fake-calendar/server";
import { fakeBandsintown } from "./fake-bandsintown/server";
import { fakeSpotify } from "./fake-spotify/server";
import type { RunningFake } from "./lib";

export const allFakes = [fakeGmail, fakeDrive, fakeCalendar, fakeBandsintown, fakeSpotify];

export async function startAll(opts: { dataDir?: string; ephemeral?: boolean } = {}): Promise<{ running: Record<string, RunningFake>; close: () => Promise<void> }> {
  const running: Record<string, RunningFake> = {};
  for (const f of allFakes) running[f.def.name] = await f.start({ dataDir: opts.dataDir, port: opts.ephemeral ? 0 : undefined });
  return { running, close: async () => { await Promise.all(Object.values(running).map((r) => r.close())); } };
}

if (process.argv[1]?.endsWith("run-all.ts")) {
  startAll().then(({ running, close }) => {
    for (const [n, r] of Object.entries(running)) console.log(`${n} ${r.url}`);
    const stop = () => close().then(() => process.exit(0));
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
  });
}
