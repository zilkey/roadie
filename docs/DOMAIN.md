# myroadie.online

The app answers at **https://myroadie.online**; `www` and the old `*.hosted.app` address redirect there. The code side
is `APP_URL` and `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` in `apphosting.yaml` plus the rewrites/redirects in `next.config.ts`.
The rest is console work, in this order. **Don't roll out the `apphosting.yaml` change until steps 1-3 are done**:
with `authDomain` on a domain that isn't connected, nobody can sign in.

1. Registrar: delete any parking A/AAAA/CNAME records on `@` and `www`.
2. Firebase console → App Hosting → `roadie-web-prod` → Settings → Add custom domain → `myroadie.online`, Quick Setup.
   Paste the TXT and A records at the registrar (host `@`; keep the TXT forever, it renews the certificate). Then add
   `www.myroadie.online` with "Redirect to an existing website" → `myroadie.online`. Wait for **Connected** (up to 24h).
   On Cloudflare, keep the records grey-cloud (DNS only) until then.
3. Sign-in:
   - Firebase → Authentication → Settings → Authorized domains: add `myroadie.online` and `www.myroadie.online`.
   - Google Cloud → APIs & Services → Credentials → "Web client (auto created by Google Service)": add JS origin
     `https://myroadie.online` and redirect URI `https://myroadie.online/__/auth/handler`. Keep the firebaseapp.com ones.
4. Branding: Firebase → Project settings → Public-facing name `Roadie`. Google Cloud → Google Auth Platform → Branding:
   name `Roadie`, home page `https://myroadie.online`, `myroadie.online` under authorized domains (a logo triggers brand
   verification, which can take days).
5. Push. Then reconnect the MCP connector in Claude at `https://myroadie.online/mcp`, update the GitHub repo homepage,
   and sign in fresh on Chrome, Safari and a phone.
