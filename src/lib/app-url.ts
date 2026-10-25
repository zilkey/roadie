/** The app's public base URL (APP_URL; https://myroadie.online in production), no trailing slash. Every generated link starts here. */
export const appUrl = () => (process.env.APP_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
