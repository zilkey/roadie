# myroadie.online

One App Hosting backend serves two hosts:

| Host | Serves |
| --- | --- |
| **app.myroadie.online** (`APP_URL`) | The app. `/` goes to your artist. Sign-in (`authDomain`) lives here |
| **myroadie.online** (`SITE_URL`) | The public site: landing page `/`, `/privacy`, `/terms`. Every other path redirects to the app |
| www.myroadie.online | GoDaddy forwarding to `https://myroadie.online` |
| old `*.hosted.app` | Redirects to the app (`next.config.ts`) |

The code side is `APP_URL`, `SITE_URL` and `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` in `apphosting.yaml`, the rewrites and
redirects in `next.config.ts`, and the host check in `src/app/(site)/page.tsx`. The decisions behind this are in the
"Branding the App as myroadie.online" doc (claude.ai/artifact/VFaPhZvjYtmLSoSBpMEAs7).

**Don't roll out until steps 1-4 are done**: with `authDomain` on a host that isn't connected, nobody can sign in.

1. Firebase console → App Hosting → `roadie-web-prod` → Settings → Add custom domain → `app.myroadie.online`, Quick
   Setup. In GoDaddy DNS, add the records it shows. GoDaddy appends the domain to names, so a name Firebase shows as
   `_acme-challenge_xyz.app.myroadie.online.` is entered as `_acme-challenge_xyz.app`. Keep the TXT forever (it renews
   the certificate). Wait for **Connected** (up to 24h).
2. Same page → Add custom domain → `myroadie.online`. First delete GoDaddy's forwarding for `@` (it owns the `@` A
   record), then add the records Firebase shows (names on `@`, the ACME CNAME as `_acme-challenge_xyz`). Wait for
   **Connected**.
3. GoDaddy → Forwarding: `www.myroadie.online` → `https://myroadie.online`, permanent (301).
4. Sign-in:
   - Firebase → Authentication → Settings → Authorized domains: add `app.myroadie.online`.
   - Google Cloud → APIs & Services → Credentials → "Web client (auto created by Google Service)": add JS origin
     `https://app.myroadie.online` and redirect URI `https://app.myroadie.online/__/auth/handler`. Keep the
     firebaseapp.com ones.
5. Branding: Firebase → Project settings → Public-facing name `Roadie`. Google Cloud → Google Auth Platform → Branding:
   name `Roadie`, support email jeff@zilkey.com, home page `https://myroadie.online`, privacy policy
   `https://myroadie.online/privacy`, terms `https://myroadie.online/terms`, `myroadie.online` under authorized
   domains. No logo for now (it triggers brand verification).
6. Push. Then reconnect the MCP connector in Claude at `https://app.myroadie.online/mcp`, update the GitHub repo
   homepage to `https://myroadie.online`, and sign in fresh on Chrome, Safari and a phone.
