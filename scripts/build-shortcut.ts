/**
 * Build the "Send to Roadie" Shortcut file: `npm run shortcut:build [app url]` (default https://app.myroadie.online).
 * Writes public/shortcuts/send-to-roadie.plist (the unsigned recipe, which the unit test keeps in step with the code) and,
 * on a Mac, signs it into public/shortcuts/send-to-roadie.shortcut (`shortcuts sign --mode anyone`): iOS only imports
 * signed files. Run it after any change to src/lib/shortcut-file.ts, bump SHORTCUT_VERSION there, commit both files.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildShortcutPlist, SHORTCUT_PATH, SHORTCUT_PLIST_PATH, SHORTCUT_VERSION } from "../src/lib/shortcut-file";

const appUrl = process.argv[2] ?? "https://app.myroadie.online";
const pub = path.join(__dirname, "..", "public");
const plistOut = path.join(pub, SHORTCUT_PLIST_PATH);
const signedOut = path.join(pub, SHORTCUT_PATH);
fs.mkdirSync(path.dirname(plistOut), { recursive: true });
fs.writeFileSync(plistOut, buildShortcutPlist(appUrl));
console.log(`wrote ${path.relative(process.cwd(), plistOut)} (version ${SHORTCUT_VERSION}, ${appUrl})`);

if (process.platform !== "darwin") {
  console.log("Not a Mac: sign it there with `shortcuts sign --mode anyone --input <plist> --output <shortcut>`");
  process.exit(0);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shortcut-"));
const unsigned = path.join(tmp, "Send to Roadie.shortcut");
fs.copyFileSync(plistOut, unsigned);
fs.rmSync(signedOut, { force: true });
execFileSync("shortcuts", ["sign", "--mode", "anyone", "--input", unsigned, "--output", signedOut], { stdio: "inherit" });
fs.rmSync(tmp, { recursive: true, force: true });
fs.chmodSync(signedOut, 0o644); // the signer writes it owner-only
console.log(`signed ${path.relative(process.cwd(), signedOut)} (${fs.statSync(signedOut).size} bytes)`);
