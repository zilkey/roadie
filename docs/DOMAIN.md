# app.myroadie.online

The app answers at **https://app.myroadie.online**. `myroadie.online` and `www` forward there (GoDaddy), and the old
`*.hosted.app` address redirects there (`next.config.ts`). The code side is `APP_URL` and
`NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` in `apphosting.yaml` plus the rewrites/redirects in `next.config.ts`. The decisions
behind this are in the "Branding the App as myroadie.online" doc (claude.ai/artifact/VFaPhZvjYtmLSoSBpMEAs7).

**Don't roll out the `apphosting.yaml` change until steps 1-3 are done**: with `authDomain` on a host that isn't
connected, nobody can sign in.

1. Firebase console → App Hosting → `roadie-web-prod` → Settings → Add custom domain → `app.myroadie.online`, Quick
   Setup. In GoDaddy DNS, add the records it shows on host `app` (keep the TXT forever, it renews the certificate) and
   remove any existing `app` record. Wait for **Connected** (up to 24h).
2. GoDaddy → Forwarding: `myroadie.online` (and `www`) → `https://app.myroadie.online`, permanent (301).
3. Sign-in:
   - Firebase → Authentication → Settings → Authorized domains: add `app.myroadie.online`.
   - Google Cloud → APIs & Services → Credentials → "Web client (auto created by Google Service)": add JS origin
     `https://app.myroadie.online` and redirect URI `https://app.myroadie.online/__/auth/handler`. Keep the
     firebaseapp.com ones.
4. Branding: Firebase → Project settings → Public-facing name `Roadie`. Google Cloud → Google Auth Platform → Branding:
   name `Roadie`, support email jeff@zilkey.com, home page `https://app.myroadie.online`, `myroadie.online` under
   authorized domains. No logo for now (it triggers brand verification).
5. Push. Then reconnect the MCP connector in Claude at `https://app.myroadie.online/mcp`, update the GitHub repo
   homepage, and sign in fresh on Chrome, Safari and a phone.
