import type { NextConfig } from "next";

const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const canonical = process.env.APP_URL ? new URL(process.env.APP_URL) : null;
// The App Hosting / Firebase default hosts. Once APP_URL is a custom domain, visits to these move there.
const OLD_HOSTS = "(?:.+\\.)?(?:hosted\\.app|web\\.app|firebaseapp\\.com)";
const onCustomDomain = !!canonical && !new RegExp(`^${OLD_HOSTS}$`).test(canonical.hostname) && !["127.0.0.1", "localhost"].includes(canonical.hostname);

// NEXT_DIST_DIR: the e2e run builds into its own folder so it can run next to `npm run dev` (Next allows one dev server per folder).
const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["firebase-admin", "genkit", "@genkit-ai/google-genai", "pdfkit"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // authDomain is our own domain, so Google sign-in's helper pages (/__/auth, /__/firebase) must be served from it.
  // App Hosting doesn't serve them like classic Hosting does: proxy them to the project's firebaseapp.com.
  async rewrites() {
    if (!project) return [];
    return ["auth", "firebase"].map((p) => ({ source: `/__/${p}/:path*`, destination: `https://${project}.firebaseapp.com/__/${p}/:path*` }));
  },
  // Old URLs keep working but land on the canonical domain. /__/ stays put so sign-in started there still finishes.
  async redirects() {
    if (!onCustomDomain) return [];
    return [{ source: "/:path((?!__/).*)", has: [{ type: "host", value: OLD_HOSTS }], destination: `${canonical!.origin}/:path`, permanent: true }];
  },
};
export default config;
