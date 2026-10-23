# Connecting an AI (MCP)

The Band Tracker MCP server lets Claude (or any MCP client) read and update the band's data with the same rules as the app: same Zod schemas, dedupe, soft delete, history. It can **draft** emails but never send them.

## 1. Get a key

1. An admin turns on **AI access** for the person (Admin > Users, "AI access" box).
2. Admin > **AI keys** > label it (for example "Jeff · Claude Code") > Create key.
3. Copy the key (`btk_...`) now. It is shown once; only its SHA-256 hash is stored. You can revoke it on the same page; a revoked key stops working immediately, even inside a running session. The page shows when each key was last used.

## 2. Run the server

```
npm run mcp          # Streamable HTTP on http://127.0.0.1:3300/mcp
```

Dev defaults to the local emulators (start them with `npm run emulators`, then `npm run seed`). For the real project set `GOOGLE_APPLICATION_CREDENTIALS` (service account JSON) and `GCLOUD_PROJECT=band-tracker`, plus the real `*_BASE_URL`s once the Google clients exist. `MCP_PORT` changes the port. `GET /health` answers without a key.

## 3. Connect Claude Code

HTTP (one shared server, many clients):

```
claude mcp add --transport http band-tracker http://127.0.0.1:3300/mcp \
  --header "Authorization: Bearer btk_YOUR_KEY"
```

stdio (Claude Code starts the server itself; the key goes in the environment):

```
claude mcp add band-tracker --env MCP_TOKEN=btk_YOUR_KEY -- npm --prefix /Users/jeff/workspace/band-tracker run --silent mcp:stdio
```

Equivalent `.mcp.json`:

```json
{
  "mcpServers": {
    "band-tracker": {
      "type": "http",
      "url": "http://127.0.0.1:3300/mcp",
      "headers": { "Authorization": "Bearer btk_YOUR_KEY" }
    },
    "band-tracker-stdio": {
      "command": "npm",
      "args": ["--prefix", "/Users/jeff/workspace/band-tracker", "run", "--silent", "mcp:stdio"],
      "env": { "MCP_TOKEN": "btk_YOUR_KEY" }
    }
  }
}
```

Use one of the two, not both. Run `/mcp` in Claude Code to check it is connected.

## What it can do

Every command in the registry whose roles include `mcp` is a tool, named like the command (`venues.create`, `shows.update`, ...), with the description and a JSON schema generated from the command's Zod input. Plus read tools: `search`, `records.get`, `records.list`, `pitches.needingFollowUp`, `songs.missingFiles` (with sharing problems), `availability.check` (list of dates), `bandsintown.reconcile`, `stats.current`, `stats.movement`, `history.myRuns`, `history.undoRun`.

What it cannot do (not tools at all): users, musicians admin, AI keys, `pitches.sendEmail`, `availability.mark`, archiving venues/promoters/festivals/contacts/songs/shows.
- Email: `pitches.draftEmail` creates a Gmail draft and a note on the pitch timeline; you review and send it from the app. `availability.ask` and `availability.remind` leave drafts when called through MCP.
- Errors: bad input comes back as a tool error whose text is `{"error":{"code":"invalid_input","message":...,"issues":[{"path":"address.state","code":"invalid_type","message":"..."}]}}`, so the AI can fix the fields and retry. Other codes: `not_found`, `forbidden`, `unauthenticated`, `unknown_tool`, `unfilled_fields`.
- Runs and undo: each MCP session has one `runId`, returned with every result and stamped on every change (`via: "mcp"`). `history.myRuns` lists your runs; `history.undoRun {runId}` reverts one (your own runs only). Admins can undo any run from Admin > History.

## Undo rules

Newest change first: created records are archived, edited records get their earlier values back, archived records come back. Each reversal is written to history under a new run id (undo that run to redo). Ledger entries and stat snapshots are never edited, so they are skipped and listed as "needs a manual correction": add a correction in Money. Undo reverts Firestore only: emails already sent, Calendar events and Bandsintown listings made by the run are not undone (use `shows.sync` / `shows.calendar` afterwards).
