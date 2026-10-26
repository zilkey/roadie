import type { NextConfig } from "next";

const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const canonical = process.env.APP_URL ? new URL(process.env.APP_URL) : null;
// The App Hosting / Firebase default hosts. Once APP_URL is a custom domain, visits to these move there.
const OLD_HOSTS = "(?:.+\\.)?(?:hosted\\.app|web\\.app|firebaseapp\\.com)";
const onCustomDomain = !!canonical && !new RegExp(`^${OLD_HOSTS}$`).test(canonical.hostname) && !["127.0.0.1", "localhost"].includes(canonical.hostname);
// SITE_URL (https://myroadie.online) serves the public site: the landing page (/), /privacy, /terms and their assets.
// Any other path there is an app link, so it moves to APP_URL.
const site = process.env.SITE_URL ? new URL(process.env.SITE_URL) : null;
const SITE_PATHS = "(?!privacy$|terms$|_next/|opengraph-image|[^/]+\\.[A-Za-z0-9]+$).+";

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
    const out = [];
    if (onCustomDomain) out.push({ source: "/:path((?!__/).*)", has: [{ type: "host" as const, value: OLD_HOSTS }], destination: `${canonical!.origin}/:path`, permanent: true });
    if (site && canonical && site.host !== canonical.host) {
      out.push({ source: `/:path(${SITE_PATHS})`, has: [{ type: "host" as const, value: site.hostname.replace(/\./g, "\\.") }], destination: `${canonical.origin}/:path`, permanent: false });
    }
    return out;
  },
};
export default config;
