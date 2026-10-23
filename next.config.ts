import type { NextConfig } from "next";
const config: NextConfig = { serverExternalPackages: ["firebase-admin", "genkit", "@genkit-ai/google-genai"], allowedDevOrigins: ["127.0.0.1", "localhost"] };
export default config;
