import type { NextConfig } from "next";
const config: NextConfig = { serverExternalPackages: ["firebase-admin"], allowedDevOrigins: ["127.0.0.1", "localhost"] };
export default config;
