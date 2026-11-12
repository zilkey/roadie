<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cloud sessions: prod access is in the environment

Claude Code cloud sessions on the "Roadie" environment have `GOOGLE_CREDENTIALS_JSON`: the `roadie-prod-iab` service account's key (JSON). `gcloud auth list` shows no account and `GOOGLE_APPLICATION_CREDENTIALS` is unset; that does **not** mean there's no prod access. To run a script against prod (a migration, a backup), write the variable to a file outside the repo without printing it, and point the script at it:

```sh
printf '%s' "$GOOGLE_CREDENTIALS_JSON" > "$TMPDIR/gcp.json" && chmod 600 "$TMPDIR/gcp.json"
GCLOUD_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS="$TMPDIR/gcp.json" npm run <script>
```

Dry-run first wherever the script has one, and never commit the key file.
