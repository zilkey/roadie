# Connecting an AI (MCP)

The Roadie MCP server lets Claude (or any MCP client) read and update the band's data with the same rules as the app: same Zod schemas, dedupe, soft delete, history. It can **draft** emails but never send them.

## 1. Access

An admin turns on **AI (MCP) access** for the person (People, the person's sheet). People with the AI-only role always have it. That's all: connecting signs in with their normal Roadie Google account (below), and there's no key to hand out.

Under the hood a sign-in mints a key (`btk_...`) for that person and artist, stores only its SHA-256 hash in `mcpTokens` (with the client's name in `client`), and gives it to the client as the bearer token. Connecting the same client to the same artist again revokes its previous key. Turning off AI access stops every key at once, even inside a running session; `lastUsedAt` is stamped on each use.

## 2. Where the server runs

The app serves it: Streamable HTTP at **`APP_URL/mcp`**, a Next route handler (`src/app/mcp/route.ts` → `mcp/web.ts`) in the same process as the rest of Roadie. Nothing extra to deploy. In dev that is `http://127.0.0.1:3100/mcp` with `npm run dev` (or `dev:all`), talking to the emulators like the app does.

It is stateless, because App Hosting runs up to two instances and scales to zero: every request re-checks the key, and the one-runId-per-session rule is kept by making the session id the runId, signed and bound to the key (`mcp/web.ts`). Production therefore needs one secret so all instances sign alike:

```sh
openssl rand -base64 32 | npx firebase apphosting:secrets:set MCP_SESSION_SECRET --project roadie-prod-iab --data-file -
npx firebase apphosting:secrets:grantaccess MCP_SESSION_SECRET --backend roadie-web-prod --project roadie-prod-iab
```

`apphosting.yaml` references it as `MCP_SESSION_SECRET`. Without it `/mcp` answers 500 with a message saying so (dev and tests use a random per-process secret).

There is also a stdio entry for Claude Code on your own machine (`npm run mcp:stdio`, key in `MCP_TOKEN`). It points at the emulators by default; for the real project set `GOOGLE_APPLICATION_CREDENTIALS` (service account JSON) and `GCLOUD_PROJECT=roadie-prod-iab`.

## 3. Connect the Claude apps (claude.ai, desktop, iPhone/Android)

Settings > Connectors > Add custom connector, URL `https://app.myroadie.online/mcp`, then Connect. These apps sign in with OAuth (`mcp/oauth.ts`):

1. `/mcp` answers 401 with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`, which names the app as the authorization server (`/.well-known/oauth-authorization-server`).
2. The client registers at `/oauth/register` and sends the browser to `/oauth/authorize`, which checks the request and redirects to **`/connect`**.
3. `/connect` (`src/app/connect/page.tsx`, outside the signed-in group so AI-only logins work) signs in with Google, or uses the sign-in already there, shows the person's artists and which have AI access, and calls `/oauth/approve` with their Firebase ID token.
4. The client trades the code (PKCE S256) at `/oauth/token`; that is where the key is minted. Refresh tokens hand back the same key while it still works.

Nothing is stored for the flow itself: client ids, pending requests (15 minutes), codes (5 minutes) and refresh tokens are sealed with `MCP_SESSION_SECRET`.

## 4. Connect Claude Code

HTTP (one shared server, many clients), then `/mcp` in Claude Code to sign in as above:

```
claude mcp add --transport http roadie https://app.myroadie.online/mcp
```

(`http://127.0.0.1:3100/mcp` against the dev server, where `/connect` offers the dev sign-in buttons.) Users get the same address from Integrations in the app. A `--header "Authorization: Bearer btk_..."` still works if you have a key.

stdio (Claude Code starts the server itself; it needs a key in the environment, for example one a sign-in minted):

```
claude mcp add roadie --env MCP_TOKEN=btk_YOUR_KEY -- npm --prefix ~/workspace/roadie run --silent mcp:stdio
```

Equivalent `.mcp.json`:

```json
{
  "mcpServers": {
    "roadie": {
      "type": "http",
      "url": "https://app.myroadie.online/mcp",
      "headers": { "Authorization": "Bearer btk_YOUR_KEY" }
    },
    "roadie-stdio": {
      "command": "npm",
      "args": ["--prefix", "~/workspace/roadie", "run", "--silent", "mcp:stdio"],
      "env": { "MCP_TOKEN": "btk_YOUR_KEY" }
    }
  }
}
```

Use one of the two, not both. Run `/mcp` in Claude Code to check it is connected.

## What it can do

Every command in the registry whose roles include `mcp` is a tool, named like the command (`venues.create`, `shows.update`, ...), with the description and a JSON schema generated from the command's Zod input. Plus read tools: `search`, `records.get`, `records.list`, `pitches.needingFollowUp`, `songs.missingFiles` (with sharing problems), `availability.check` (list of dates), `bandsintown.reconcile`, `stats.current`, `stats.movement`, `fans.counts`, `fans.near`, `fans.newSince` (counts only; `fans.list`, `fans.forBandzoogle` and the fan write commands are for artist admins), `history.myRuns`, `history.undoRun`.

What it cannot do (not tools at all): users, musicians admin, AI keys, `pitches.sendEmail`, `availability.mark`, archiving venues/promoters/festivals/contacts/songs/shows.
- Email: `pitches.draftEmail` creates a Gmail draft and a note on the pitch timeline; you review and send it from the app. `availability.ask` and `availability.remind` leave drafts when called through MCP; their `channel: "signal"` is app-only (only a person can post to the Signal group), so Roadie gives the admin the text and the group link instead.
- Errors: bad input comes back as a tool error whose text is `{"error":{"code":"invalid_input","message":...,"issues":[{"path":"address.state","code":"invalid_type","message":"..."}]}}`, so the AI can fix the fields and retry. Other codes: `not_found`, `forbidden`, `unauthenticated`, `unknown_tool`, `unfilled_fields`.
- Runs and undo: each MCP session has one `runId`, returned with every result and stamped on every change (`via: "mcp"`). `history.myRuns` lists your runs; `history.undoRun {runId}` reverts one (your own runs only). Admins can undo any run from Admin > History.

## Undo rules

Newest change first: created records are archived, edited records get their earlier values back, archived records come back. Each reversal is written to history under a new run id (undo that run to redo). Ledger entries and stat snapshots are never edited, so they are skipped and listed as "needs a manual correction": add a correction in Money. Undo reverts Firestore only: emails already sent, Calendar events and Bandsintown listings made by the run are not undone (use `shows.sync` / `shows.calendar` afterwards).
