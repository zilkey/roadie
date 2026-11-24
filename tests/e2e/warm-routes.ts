import { APP } from "./env";

/**
 * Playwright's globalSetup, run once the shard's Next dev server is up. `next dev` compiles a route the first time it is
 * hit, and on a loaded machine that compile can outlast a test's 15 s wait: an upload sat at "Uploading… 100%" until
 * the test gave up. Hitting each upload route once here (unsigned, so it only answers 401) compiles them before any
 * spec runs. Add a route here when it takes a file.
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

export default async function warmRoutes() {
  await Promise.all(UPLOAD_ROUTES.map((route) =>
    fetch(`${APP}${route}`, { method: "POST", signal: AbortSignal.timeout(180_000) })
      .then((res) => res.arrayBuffer())
      .catch(() => undefined)));
}
