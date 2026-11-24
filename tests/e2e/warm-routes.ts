import { APP } from "./env";

/**
 * Playwright's globalSetup, run once the shard's Next dev server is up. `next dev` compiles a route the first time it is
 * hit, and on a loaded machine that compile can outlast a test's 15 s wait: an upload sat at "Uploading… 100%" until
 * the test gave up. Hitting each upload route once here (unsigned, so it only answers 401) compiles them before any
 * spec runs. Add a route here when it takes a file. Routes that stream a file back (the inline audio player's fetch) are warmed
 * with a GET the same way: a cold compile there left the player on "Loading" past the wait.
 */
const UPLOAD_ROUTES = [
  "/api/songs/warm/upload",
  "/api/rehearsals/warm/recording",
  "/api/releases/warm/files",
  "/api/shows/warm/posters",
  "/api/posts/upload",
  "/api/assistant/transcribe",
  "/api/assistant/read-image",
];
const STREAM_ROUTES = ["/api/files/warm/audio"];

export default async function warmRoutes() {
  await Promise.all([...UPLOAD_ROUTES.map((route) => ["POST", route]), ...STREAM_ROUTES.map((route) => ["GET", route])].map(([method, route]) =>
    fetch(`${APP}${route}`, { method, signal: AbortSignal.timeout(180_000) })
      .then((res) => res.arrayBuffer())
      .catch(() => undefined)));
}
