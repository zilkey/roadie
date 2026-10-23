import type { NextConfig } from "next";
// NEXT_DIST_DIR: the e2e run builds into its own folder so it can run next to `npm run dev` (Next allows one dev server per folder).
const config: NextConfig = { distDir: process.env.NEXT_DIST_DIR || ".next", serverExternalPackages: ["firebase-admin", "genkit", "@genkit-ai/google-genai"], allowedDevOrigins: ["127.0.0.1", "localhost"] };
export default config;
