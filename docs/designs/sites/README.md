# Sites: Roadie writes, previews and publishes artists' websites

Status: phases 1–4 built (2026-11-23), cutover (phase 5) not started. Issue: zilkey/roadie-issues#90. Canvas: https://claude.ai/artifact/D7uszAiyCLJbhgHBwPLCKE

## What's built, and where it differs from the design

Built: the schema and storage (`src/schema/sites.ts`, `src/server/sites/store.ts`), the sanitizer and `render()`, the Hosting
client with an in-memory fake (`src/server/integrations/hosting.ts`), `buildVersion` / `releaseVersion` / `reconcile`
(`src/server/sites/publish.ts`), the three blocks, the 10-minute refresh (`src/server/sites/refresh.ts`,
`/api/cron/site-refresh`, `.github/workflows/site-refresh.yml`), the `site.*` commands, Roadie's draft tools (the `website`
tool group), and Settings › Website (preview, page picker, Draft / Staging / Live, Desktop / Phone, Publish, Promote, History,
Roll back). `scripts/sites.ts` creates a site, imports a folder of files, publishes and promotes.

Taken differently, for now:

- **Project.** Sites are served from Firebase Hosting in `roadie-prod-iab` (`SITES_HOSTING_PROJECT` in `apphosting.yaml`), not
  a separate `roadie-sites` project, because the service-account key can't create projects or link billing. Hosting is still a
  separate product from App Hosting, so an app outage leaves sites up. Moving to `roadie-sites` later is a new pair of Hosting
  sites plus one publish.
- **Images live in Firestore** (`siteAssets/{sha256}`, at most ~950 KB each, resized to 2000 px by the import script), not
  Firebase Storage. No Storage setup, rules or emulator were needed. `site.uploadImage` isn't built: images come in through
  `scripts/sites.ts import`.
- **No mirror bucket or standby yet** (Redundancy). Viewing a published version renders it from its frozen sources instead of
  reading a mirror prefix (`site.preview` with `n`).
- **The fake Hosting API is in process** (globalThis), not an HTTP server under `fakes/`.
- **Publish runs through the normal command route**, not a separate `/api/sites/release` with a 300-second limit. Only the first
  publish of a site uploads much, and that one ran from the script.
- **Website is a main-menu section** (`/website`, admins only, shown when `artists.features.sites` is on). It starts in More; Customize menu can move it into the bar.
- **No domains screen** (phase 5): `ingridavison.com` still points at Bandzoogle.

## What it costs

Measured on Ingrid's site: 9 pages, 19 images, about 7 MB per version, of which only changed files upload.

| Part | Free allowance | Ingrid's use | Per month |
| --- | --- | --- | --- |
| Firebase Hosting storage | 10 GB | well under 1 GB, even with 100 retained versions per site | $0 |
| Firebase Hosting transfer | 360 MB a day (~10 GB a month), then $0.15/GB | a visit with the heavy photos is ~2–3 MB, so ~4,000 visits a month fit | $0 (about $0.15 per 1,000 extra visits) |
| Custom domain + certificate | free | | $0 |
| Firestore (drafts, sources, versions, images) | 1 GiB stored, 50k reads/day | ~10 MB stored; the refresh reads ~1,500 docs a day | $0 |
| App Hosting (the refresh every 10 minutes) | Cloud Run's free tier | 144 short calls a day | $0 |
| GitHub Actions (the refresh schedule) | public repo | | $0 |
| Roadie chat edits (Claude Sonnet 5.5) | | roughly $0.05–0.30 per edit request (the tool list is ~100k tokens, mostly cache reads at $0.10/M) | a few dollars at most |
| Cold standby (not built) | | | $0; hot would be ~$18 |

So for one artist: about **$0 a month for hosting**, plus whatever chat edits cost, well under $5 a month; **$0–60 a year**.
The domain (registered at Squarespace) and the email-list provider are separate, and both are Ingrid's whatever hosts the site.

## Goal

Roadie hosts artists' websites, starting with Ingrid Avison's. Her site is on Bandzoogle today, and so is her mailing
list.

The editor is the Roadie chat panel next to a live preview. You ask Roadie (the assistant) for a change, it edits the
draft, and the preview updates. A person's edits reach the public site only when a person presses **Publish**. The one
automatic change is the **data refresh** (Decision 5): when the shows a site lists change, its show list is re-rendered
from the pages already published, with no draft edits. Any published version can be rolled back.

Published pages are static HTML that search engines read directly. Each artist has a production domain and a staging
domain, and Roadie helps connect both.

Two fixed requirements shape the design:

1. **An outage of the Roadie app must not take the sites down.** The app (`roadie-web-prod`) can be broken, part-way
   through a rollout or out of quota, and every published site keeps serving. Only editing and publishing stop.
2. **Roadie does not run the mailing list.** Each artist uses a standard email-list provider. The first provider isn't
   chosen yet, and Roadie will support many. The provider holds the list of record and does all sending, unsubscribes
   and compliance. Roadie points a signup form at it.

## Terms

| Term | Meaning |
| --- | --- |
| **Roadie app** | The Next.js app at app.myroadie.online (`roadie-web-prod` in project `roadie-prod-iab`). |
| **Roadie (the assistant)** | The chat panel in the app. Its tools are app commands; `src/server/assistant/policy.ts` decides which. |
| **Website section** | The new app page where the site is edited: preview plus chat. Settings › Website holds domains, the list provider and the auto-refresh switch. |
| **Draft** | The site's editable files in Firestore: pages, partials, one stylesheet and `site.json`. The assistant and the editor change only the draft. |
| **Version** | One release to one Hosting site: an immutable record of every file's source and the files Hosting serves. Versions are numbered 1, 2, 3… per artist site. (They're not called releases because `releases` are already the music records.) |
| **Live** / **Staging** | Each artist's two Firebase Hosting sites. Live serves the production domain. Staging serves the staging domain and is never indexed by search engines. |
| **Preview** | The draft, rendered inside the app. It isn't public. |
| **Block** | A tag such as `<roadie-shows>` in a page, replaced with Roadie data when a version is rendered. |
| **Run** | Every write in one assistant turn shares a `runId`, and `history.undoRun` reverses the whole run. |
| **List provider** | The artist's email-list service. It owns the subscribers. |
| **Person only** | A command the assistant and MCP can never call. It's listed in `EXCLUDED` (`policy.ts`), and its roles leave out `mcp` (`src/server/ctx.ts`). |

## How it works

```
 EDIT (app up)                     RELEASE (app up)                           SERVE (no app needed)
 Website section                   publish / promote / rollback /             visitor → ingridavison.com
   preview = render(draft)         refresh, all through releaseVersion():       │
   chat → site.* commands            build (Hosting version + mirror          Firebase Hosting (project roadie-sites)
       │                             prefix) → lease → release → record       global CDN, static files only
       ▼                             → mirror pointer (live.json)               │
 Firestore (roadie-prod-iab)                                                  signup form → list provider
   sites, sitePages,                                                          (posts straight to the provider)
   siteSources, siteVersions
                                                                              fallback: mirror bucket + standby
                                                                              load balancer (Redundancy)
```

Nothing on the serving path calls the Roadie app, Firestore or project `roadie-prod-iab`.

## Decision 1: Firebase Hosting, in its own project

Every version is a complete set of static files: HTML, CSS, images, `sitemap.xml` and `robots.txt`. A version never
changes, so serving it needs no code. Firebase Hosting serves static files from Google's global CDN, with versions,
releases and rollback built in.

| Need | How Firebase Hosting covers it |
| --- | --- |
| Independent of the app | Hosting is a different product from App Hosting, so a broken `roadie-web-prod` doesn't touch it. |
| Upload only what changed | The REST API takes the SHA-256 of each gzipped file (`populateFiles`, at most 1000 per call) and returns only the hashes it lacks. |
| Atomic switch | `releases.create` points a site at a finalized version, and every request switches at once. |
| Rollback | A new release pointing at an older version (the console's Roll back does this). Phase 1 tests the API path. |
| History | `retainedReleaseCount` on the live channel can be 1–100. We set it to 100. |
| Redirects, headers | A version's `ServingConfig` holds `redirects` (301s from the old site), `headers` (CSP, cache, `X-Robots-Tag`) and `cleanUrls`. |
| Custom domains + TLS | `projects.sites.customDomains` (REST v1beta1) returns the DNS records it needs (`requiredDnsUpdates`) and the certificate state. |

**A separate project, `roadie-sites`, on Blaze.** Keeping sites out of `roadie-prod-iab` does three things:

- Artist HTML never shares an origin or cookies with app.myroadie.online.
- Hosting quotas never compete with the app's.
- An IAM mistake in one project can't break the other.

It has to be on Blaze, because Spark disables sites that go over the free transfer allowance.

**Two Hosting sites per artist**, `<slug>` (live) and `<slug>-staging`. Staging is a second site rather than a preview
channel, for two reasons: custom domains attach to a site's live channel, and preview channels expire. A project holds
at most 36 Hosting sites, which is 18 artists. Past that, Roadie creates `roadie-sites-2` and records the project on the
artist's `sites` doc.

**Access.** The app calls the Hosting REST API with firebase-admin's application default credentials. On App Hosting,
that's `firebase-app-hosting-compute@roadie-prod-iab.iam.gserviceaccount.com`. Every call sends
`x-goog-user-project: roadie-sites`, so quota and billing land on the sites project.

On `roadie-sites`, that account gets exactly these roles:

- `roles/firebasehosting.admin`
- `roles/serviceusage.serviceUsageConsumer`
- `roles/certificatemanager.editor`, to create the standby's DNS authorizations when a domain is added
- `roles/storage.objectAdmin`, on the mirror bucket only

The app never builds or changes the standby load balancer.

- **By hand:** a person runs `scripts/sites-standby.ts` and `scripts/sites-republish.ts` with the `.secrets` key
  (`firebase-adminsdk-fbsvc@roadie-prod-iab`). On `roadie-sites` that key gets the app's Hosting and mirror roles,
  plus `roles/compute.loadBalancerAdmin` and `roles/certificatemanager.editor`.
- **From GitHub Actions:** the monthly mirror prune and the hot standby's sync use their own service account,
  `sites-standby@roadie-sites`. It has `roles/compute.loadBalancerAdmin`, `roles/firebasehosting.viewer` (the prune
  checks which versions Hosting still holds, and aborts if that read fails) and `roles/storage.objectAdmin` on the
  mirror bucket. The workflows reach it through Workload Identity Federation from this repo's `main` branch, so no key
  is stored. Phase 1 setup creates the identity pool, its GitHub provider, the service account and the binding with
  `scripts/sites-standby.ts --setup-ci`. That one step runs with the `roadie-sites` project owner's own `gcloud`
  login, not the `.secrets` key, because it creates IAM. This is new: the cron routes check GitHub's token inside the app, with no
  Google Cloud identity pool.

### Rejected and deferred

| Option | Status | Why |
| --- | --- | --- |
| Serve sites from `roadie-web-prod` | Rejected | Breaks requirement 1: an app outage, a bad deploy or the `maxInstances: 2` cap would take every site down. |
| A second App Hosting backend that renders on each request | Rejected | It still needs Firestore on every request, in one region. Static files survive more failures with fewer parts. |
| A GitHub repo per artist as the store | Deferred | Every edit would become a commit plus a deploy, with a token per artist. `SiteStore` (Decision 2) leaves room for a GitHub export or mirror. |
| Google Sites | Rejected | It has no API for writing pages. |

## Decision 2: storage

The new kinds are registered in `OWNERS` (`src/schema/owners.ts`), `PARENTS` (for the three sub-collections), the
`collections` map (`src/schema/index.ts`) and `firestore.rules`. Their Zod schemas live in `src/schema/sites.ts`. Code
writes logical paths and lets `pathOf` place them; under `nestedPaths` that's `artists/{a}/…`.

```
sites/{artistId}                     artist kind, server-written: {artistId, name, hosting {project, liveSite,
                                     stagingSite}, liveVersion?, stagingVersion?, nextN, autoRefresh,
                                     refreshPaused {live?, staging?}, lease?}
  sitePages/{pageId}                 PARENTS sites. The draft, one doc per file; pageId = sha256(path), first 40 hex
                                     (like fanId), so a path can't exist twice: {artistId, path, kind: page|partial|css|config, body}
  siteSources/{sha256}               PARENTS sites, immutable. A file's source as published: {artistId, path, kind, body}
  siteVersions/{n}                   PARENTS sites: {artistId, n, site: live|staging, state: pending|done|failed,
                                     kind: publish|promote|rollback|refresh|reconcile, sources {path → sha256} | null,
                                     blockInputs, outputs, hostingVersion, baseVersion?, fromVersion?,
                                     releaseName?, leaseToken, by, at, note?, error?}
                                     outputs: {path → gz}, Hosting's hash of each gzipped file
siteDomains/{host}                   server kind: {artistId, role: live|www|staging}
```

- **One site per artist for now.** Its id is the artist's id, so it's unique in both the nested and the flat layout
  (e2e still runs flat with `ROADIE_NESTED_PATHS=0`). A second site per artist would get a new id scheme later. The `sites` doc carries
  `artistId` like every artist record, because the Writer finds a sub-collection's artist from its parent doc.
- **Creating a site** is `scripts/sites-create.ts --artist <id> [--dry-run]` until phase 6 puts it in Settings. It
  creates the two Hosting sites, the `sites/{artistId}` doc (`nextN: 1`, `autoRefresh: true`) and any seed pages.
- **The Writer touches only the draft.** `sitePages` writes autosave, join the run and can be undone. Every kind
  carries `artistId`: the Writer stamps it on `sitePages`, and `stampSystem` stamps it on the rest.
- **Everything else is written raw.** `sites`, `siteSources`, `siteVersions` and `siteDomains` are written with the
  Admin SDK by the release code only, so undoing an edit run can never move a public site. These raw writes all go through
  one helper, `stampSystem(doc, {by, runId})` in `src/server/sites/store.ts`. It fills every field of `commonShape`
  (`src/schema/common.ts`): `id`, `schemaVersion`, `createdAt`, `updatedAt`, `createdBy` and `updatedBy` (the person's
  uid, or `"system"` for refresh and reconcile), `via: "app"`, `runId` (the lease token, which is never a real run, so
  undo never sees it) and `deletedAt: null`. `artistId` is a field of each kind's own schema. With that, `sites`,
  `siteSources` and `siteVersions` validate on restore against their `collections` entries like any record. A test
  round-trips one of each through `validateRow`. `siteDomains` is a top-level server kind
  with no schema, so it joins `SERVER_KEPT` in `src/server/backup.ts`.
- **Site config is a draft file too.** `site.json` (`kind: config`) holds:
  - `canonicalHost`, the production host that canonical tags and the sitemap use. It starts as `<slug>.web.app`.
    Connecting a domain writes the new host into the draft and asks for a publish, so the tags switch with a normal
    publish.
  - the 301 map;
  - the list provider's form URL and field names;
  - any extra headers.

  Because it's versioned with the pages:
  - a config change is published like any edit, to staging first or straight to live;
  - a rollback restores that version's config;
  - a refresh never ships config nobody published.
- **Sources are content-addressed.** Each file's source is saved once under its hash, and every version lists its
  `sources`. So any version's pages can be rendered again. Blocks always use the data current at render time.
- **"Changed since the last publish"** compares the draft's source hashes with the live version's `sources`.
- **Version numbers** are one sequence per site doc (`nextN`, taken in the lease transaction), shared by live and
  staging. "Version 14" always names one thing.
- **Images.** Originals go in `roadie-prod-iab`'s default Firebase Storage bucket. Phase 1 setup turns on Firebase
  Storage for the project if it isn't on yet, which creates that bucket already linked to Firebase, so `storage.rules`
  applies to it. They live at `sites/{artistId}/img/{sha256}.{ext}`. That's the editing copy, with
  object versioning on.
  - At render, images are resized and included as files in the Hosting version. Serving never reads the app's bucket,
    and Hosting dedupes them by hash.
  - The app has no Storage code yet. Phase 1 adds `src/server/storage.ts`, `storage.rules` (no client
    access) and the Storage emulator. The emulator goes in `firebase.json` and `firebase.test.json`, and is added to
    `--only` in `scripts/e2e.ts` and the `test:emulator` script in `package.json`. Its port goes in `scripts/e2e.ts`,
    `tests/e2e/env.ts` and `playwright.config.ts`.
- **Size.** Firestore's 1 MiB doc limit fits a page of HTML. Images never go in Firestore.
- **`SiteStore`** (`src/server/sites/store.ts`) is the only module that reads or writes pages, sources and versions.
  Firestore is its first implementation, which leaves room for GitHub or a bucket later.
- **Backups.** The nightly job (`.github/workflows/backup.yml`) has never run (`docs/BACKUP.md`). Phase 0 turns it on.

## Decision 3: rendering and releasing

### render()

`render(files, data, mode)` in `src/server/sites/render.ts` is the one function behind the preview and every version.
`mode` is `public` or `preview`. It runs these steps:

1. **Sanitize the author's source** (see Security). This is the only HTML a person or the assistant wrote.
2. Expand partials (header, footer) into each page.
3. Insert the **generated, trusted nodes**. This happens after sanitizing, so they're never stripped:
   - block output;
   - `<link rel="canonical">`, always on `site.json`'s `canonicalHost`;
   - Open Graph and Twitter tags;
   - JSON-LD `<script type="application/ld+json">`, with every `<` written as `\u003c`.
4. Write `sitemap.xml` (URLs on `canonicalHost`) and one `robots.txt` (allow all, plus the sitemap link). Both are the same for
   live and staging.
5. Images:
   - `public` rewrites them to the resized files, with `srcset`;
   - `preview` signs them through a new `/api/sites/img` route (a new `siteImg` scope in `src/server/signedUrl.ts`) and
     inlines the CSS, so the sandboxed preview needs no other requests.
6. Build the Hosting config from `site.json` plus the fixed security headers. Staging adds `X-Robots-Tag: noindex`.

It also returns `blockInputs`: a hash of exactly the data the blocks used (the public show list as rendered, and the
links).

The files are byte-identical for live and staging; only the Hosting config differs. `robots.txt` never says `Disallow`,
because that would hide the `noindex` header from crawlers. A test checks that no version has `Disallow: /`.

### Building and releasing

Two functions in `src/server/sites/publish.ts`:

- **`buildVersion({site, files, data})`** runs before any lease is taken. It renders, creates a Hosting version on
  that site with its config, calls `populateFiles` in batches of 1000, uploads the missing gzipped files and finalizes.
  It also writes the whole version to its own immutable mirror prefix (Redundancy). It returns `hostingVersion`,
  `outputs` and `blockInputs`. If the release is then refused, a build made by this call is deleted, both the Hosting
  version and its mirror prefix. A rollback's re-used `hostingVersion` is never deleted. A killed job's build is left
  for retention to prune.
- **`releaseVersion({site, kind, sources, build, by, baseVersion?, fromVersion?})`** is the only code that changes what
  a Hosting site serves. `build` is a finished `buildVersion` result, or, for a rollback, a retained version's
  `hostingVersion`, `outputs` and `blockInputs` copied from version `n`. It runs five short steps; the slow work already
  happened in `buildVersion`.
  1. **Lease and check.** In one transaction:
     - take `sites.lease = {token, by, until}` for 120 seconds, or fail with "Someone is publishing";
     - when `baseVersion` is given, refuse unless the site's pointer (`liveVersion` or `stagingVersion`) still equals
       it, with "The site changed while this was being prepared". Refresh, promote and rollback always pass it, so
       nothing built from an older version can undo a newer Publish;
     - take `n = nextN`, and write `siteVersions/{n}` as `pending` with `sources`, `hostingVersion`, `outputs`,
       `blockInputs` and `leaseToken`.
  2. **Guard.** In a transaction, confirm the lease is still ours with at least 60 seconds left. A Hosting call can't
     sit inside a Firestore transaction, so this narrows the race rather than closing it; step 4 and reconcile cover the
     rest.
  3. **Release.** Call `releases.create` with `hostingVersion` and the message `roadie:{n}:{leaseToken}`, and store the
     returned release name on the version. The message is how reconcile recognizes Roadie's own releases, even after a
     crash right after this call.
  4. **Record.** In one transaction, if the lease is still ours:
     - mark the version `done`;
     - set `liveVersion` or `stagingVersion` to `n`;
     - set or clear that site's refresh pause: a rollback sets `refreshPaused.{site}`, and a publish or promote to that
       site clears it.

     The lease is kept for step 5. If the lease isn't ours, leave the version `pending` for reconcile and stop.
  5. **Mirror pointer, then let go.** Still holding the lease, write the site's `live.json` in the mirror (Redundancy)
     to name this build's prefix. It's one small object, written with a generation precondition. Then clear the lease
     in a transaction. No other release can run between the pointer move and the `live.json` write, so it can't be left
     naming an older build.

  **On failure:**
  - An error before step 3 marks the version `failed`.
  - An error in step 3 or step 4 leaves it `pending`, because the release may have landed.
  - An error in step 5 leaves the version `done` with `live.json` stale.

  In every case the lease is cleared if it's still ours, and reconcile runs and repairs whatever is left.

**Reconcile** (`site.reconcile`) makes the version docs match what Hosting serves. It runs after any failed step,
inside the refresh job, and when an admin loads the Website section.

- **It takes the same lease** (and skips quietly if it's held), then reads `releases.list` for both Hosting sites while
  holding it. A publish can't start in the middle.
- **Only the newest entry** in each site's `releases.list` sets that site's pointer. A late-settled older version never
  moves it.
- **Pending and failed versions.** A `pending` version whose lease is no longer held, or a `failed` one, is marked `done` if
  a release carries its `roadie:{n}:{leaseToken}` message, and `failed` otherwise. Matching on the message, not the
  `hostingVersion`, means a rollback that never released can't be mistaken for one that did.
- **Settling applies step 4's rules.** When reconcile settles a version as `done` and it's the newest release, it
  moves the pointer and applies the pause rule for that version's `kind`, as step 4 would.
- **`live.json` always follows Hosting.** On every run, still holding the lease, reconcile makes each Hosting site's
  `live.json` name the prefix of that site's newest release, if that prefix exists. The write is guarded only by the
  generation precondition, never by `n`. Whatever went wrong earlier, the mirror pointer matches what Hosting serves
  within 10 minutes.
- **Releases Roadie didn't make.** If the newest release has no `roadie:` message (for example, a rollback in the
  console), reconcile records a `kind: reconcile` version and moves the pointer to it. It also sets that site's refresh
  pause, so the next refresh doesn't rebuild a version someone rolled back to on purpose.
  - Its `sources`, `outputs` and `blockInputs` are copied from the version with that `hostingVersion`.
  - When no version matches, `sources` is `null` and `outputs` come from `versions.files.list`. If no mirror prefix
    exists for that `hostingVersion`, `live.json` is left alone and `site.status` says "standby copy is behind". That
    can only happen for a version Roadie didn't build, because the prune keeps the prefix of every version Hosting
    still holds.

A version with `sources: null` can't be rebuilt:

- refresh always skips it;
- Promote from it says "Publish to staging first";
- it can be rolled back to only while Hosting still holds its `hostingVersion`. After that, Roll back is hidden.

Publish, promote and rollback run in a dedicated route, `src/app/api/sites/release/route.ts`, not the generic command
route, because a first publish with many images can take minutes. The route sets `export const maxDuration = 300`, and
`apphosting.yaml` sets `runConfig.timeoutSeconds: 300` so the request isn't cut off first. A job killed at the limit
leaves either an unreleased build, or a `pending` version that reconcile settles.

### The commands that release

- **`site.publish({site})`** (admins, person only) runs `buildVersion` from the draft, then
  `releaseVersion({site, kind: publish, sources: draft hashes, build, by})`.
- **`site.promote()`** (admins, person only) builds staging's current `sources` with current data for the live site,
  then runs `releaseVersion({site: live, kind: promote, sources, build, by, baseVersion: liveVersion, fromVersion:
  stagingVersion})`.
  - The files normally match staging's, so nothing uploads.
  - If shows changed since staging was published, only the block output differs. The confirm then says "Shows have
    changed since staging was published; live gets today's list."
- **`site.rollback({site, n})`** (admins, person only), where `n` is a `done` version of that site:
  - If Hosting still holds its `hostingVersion` (the last 100 releases on that site), it runs
    `releaseVersion({site, kind: rollback, sources, build: <copied from n>, by, baseVersion: <current pointer>,
    fromVersion: n})` with no new build.
  - Otherwise it builds from that version's `sources` first.
  - A rollback **pauses refresh** for that Hosting site (`refreshPaused.live` or `.staging`, set in step 4), so refresh
    never rebuilds the version that was chosen. The next publish or promote to that site clears the pause. History
    and the Website header say "Shows aren't updating after a rollback; publish to resume".

## Decision 4: blocks

A page may contain only these blocks. An unknown block fails validation when the page is saved.

```html
<roadie-shows limit="10"></roadie-shows>   upcoming public shows, plus MusicEvent JSON-LD
<roadie-signup></roadie-signup>            the list provider's form (Decision 6)
<roadie-links></roadie-links>              the artist's links, plus MusicGroup JSON-LD with sameAs
```

- **Public shows** follow the Bandsintown rule, `bandsintownEligible` (`src/lib/bandsintown.ts`): confirmed, dated
  today or later in the artist's time zone (`src/server/zone.ts`), not deleted, and at a venue or festival.
- **Names and places** come from `publicShowName` and `showCity` (`src/lib/shows.ts`).
- **Links** come from `ARTIST_LINKS` and the artist's `links` (`src/schema/artists.ts`).
- **Output** is plain HTML with documented classes (`.roadie-shows`, `.roadie-show`, …) that the site's CSS styles.

## Decision 5: data refresh

Blocks are filled at render time, so they can go stale. Refresh doesn't hook into writes. Instead it compares what the
blocks would show now with what they showed when each site's current version was built.

- **Schedule.** `.github/workflows/site-refresh.yml` calls `/api/cron/site-refresh` every 10 minutes, using the existing
  GitHub OIDC pattern. The route passes its own workflow name to `src/server/cronAuth.ts`, which needs no change.
- **Reconcile first, for every site**, whether or not `autoRefresh` is on, so the pointers and `live.json` are repaired
  every 10 minutes.
- **Then, for each site with `autoRefresh` on**, and for each of its two Hosting sites:
  1. Skip it if refresh is paused there.
  2. Compute the current `blockInputs`. That's a few reads: the artist's upcoming shows and links.
  3. If they differ from the current version's `blockInputs`, run `buildVersion` from that version's `sources` with
     current data, then `releaseVersion({site, kind: refresh, sources, build, by: "system", baseVersion: <that
     version's n>})`. If a person published in the meantime, `releaseVersion`'s step 1 refuses, and the next run
     starts from the new version.

  It also skips a site whose lease is held (the next run picks it up) and a site whose current version has
  `sources: null`.
- **What this catches.** Every way the data changes:
  - a show is created, moved, cancelled or deleted;
  - a venue is renamed (the venues denormalizer already rewrites `shows.venue`);
  - a link is edited;
  - a show passes its date, because the "today or later" rule changes the set.

  The 10-minute cadence acts as the debounce.
- **History** shows these versions as "Data refresh (shows changed)".
- **Turning it off.** Settings › Website has an "Update shows automatically" switch, on by default and stored in
  `sites.autoRefresh`. When it's off, the Website header shows "Shows changed since the last publish", using the same
  `blockInputs` comparison.
- **If the app is down,** sites keep their last render.

## Decision 6: the list provider

Roadie never stores, sends to or exports the provider's list.

- **Phase 4 (Ingrid): a plain signup form.** `<roadie-signup>` renders a plain
  `<form method="post" action="[provider form URL]">`. It works without JavaScript, and a link to the provider's hosted
  signup page sits underneath.
  - The admin pastes the provider's form URL or embed code in Settings › Website › Email list. Roadie keeps only the
    action URL and field names, in the draft's `site.json`, so the form goes live with the next publish. The screen
    parses the paste in the browser and saves through `site.write` on `site.json` (admins), so it needs no command of
    its own.
  - The form posts straight to the provider, so it works when Roadie is down.
  - Consent, double opt-in and unsubscribe are the provider's job.
- **Later: a `ListProvider` adapter per provider**, in `src/server/listProviders/<id>.ts`.
  - It adds an optional connect, by OAuth or API key, so Roadie can list the provider's lists, show a subscriber count
    on the Fans page, and read the sending DNS records.
  - Credentials are encrypted the way Google refresh tokens are (the `GOOGLE_TOKEN_KEY` pattern), and never reach a
    page.
- **Roadie's own fan signups.** The show signup page (`/f/[slug]`) and paper sheets still write `fans/{id}`
  (`src/server/fans.ts`).
  - Today an admin copies them to Bandzoogle with `fans.forBandzoogle` / `fans.markSynced`
    (`src/server/commands/fans.ts`).
  - Once an adapter exists, new signups go to the provider instead, and the Bandzoogle step retires. Until then, `fans`
    is unchanged.
  - Whether `fans` stays as an inbox is a later decision. It doesn't block hosting.
- **Ingrid's subscribers** are exported from Bandzoogle and imported with the provider's own importer, keeping consent
  dates. Roadie isn't involved.

## Decision 7: domains and DNS

| Host | Site | Example |
| --- | --- | --- |
| Production | live (apex + `www`) | `ingridavison.com`; `www.ingridavison.com` 301s to the apex |
| Staging | staging, with the `noindex` header | `staging.ingridavison.com`, or `<slug>-staging.web.app` until a domain is connected |

**Claims.** Adding a domain first creates `siteDomains/{host}` in a transaction, so a host already held by another
artist is refused. The server works out the site from the caller's `artistId`, never from input.

**Settings › Website › Domains** (admins, person only, `site.domains.add/remove/check`):

1. **Add the domain.** The admin types it. Roadie claims three hosts, the apex, `www.` and `staging.`, each with its
   own `siteDomains` doc. It calls `customDomains.create` for the apex and for `www.` (set to redirect to the apex) on
   the live site, and for `staging.` on the staging site. It creates a Certificate Manager DNS authorization for each
   of the three hosts (see Redundancy) and rewrites the mirror's `domains.json`. Then it shows every record at once:
   the ones in `requiredDnsUpdates`, plus the three authorization CNAMEs. Removing a domain undoes all of this.
2. **Automatic DNS, where possible:**
   - **Domain Connect** is live at GoDaddy, IONOS and Cloudflare. The owner clicks "Connect with GoDaddy", approves on
     GoDaddy's page, and the records are applied from Roadie's template. Onboarding takes a pull request to the Domain
     Connect templates repo, then each provider's own review. That ships in phase 6. Ingrid's registrar is likely
     GoDaddy and reviews are slow, so start early.
   - **Cloudflare API:** the owner pastes a scoped token, and Roadie writes the records.
3. **Manual records for everyone else.** Each record has a Copy button, and a status polls `customDomains.get` until
   the certificate is `CERT_ACTIVE`. When the registrar is GoDaddy, the screen adds the naming tip from
   `docs/DOMAIN.md`: enter `staging`, not `staging.ingridavison.com`.
4. **Sending records** for the list provider (SPF, DKIM, DMARC). In phase 5 the admin types them in from the
   provider's setup page; later the adapter supplies them. Roadie checks them with DNS lookups.

DNS changes face the outside world and are slow to undo, so the assistant has no domain tools.

## Decision 8: the Website section

The canvas boards show these screens.

- **Layout.** The preview sits on the left and the existing resizable Roadie panel on the right (roadie-issues#83).
  Above the preview are a page picker (Home, Shows, Music, About, Contact, + New page), a **Draft / Staging / Live**
  switch and a **Desktop / Phone** switch.
- **Header.** It shows "3 changes not published" (from source hashes), plus **History**, **Publish to staging** and
  **Publish**. Publish opens a confirm with the target (live, staging, or promote staging), the changed files and an
  optional note.
- **History.** Each version shows its number, site, kind, who, when, the files changed and the note, with **View** and
  **Roll back**. A version that's no longer in Hosting's history is marked "re-renders on rollback".
- **Viewing Staging, Live and old versions.** These work exactly like the draft preview.
  - `site.viewPage({site, n, path})` (members, a normal signed-in command) reads that page from the version's mirror
    prefix. It inlines the page's CSS and signs its image URLs with the `siteImg` scope. Those URLs point at the
    resized files in that same mirror prefix, so the page shows exactly what was published.
  - View is hidden for a version that has no mirror prefix: one the prune removed, or one Roadie didn't build.
  - The Website section shows the result in the same sandboxed `<iframe srcdoc>`.
  - No request from the iframe needs a sign-in, and the public sites keep `frame-ancestors 'none'`.
- **Links inside any preview.** The page picker handles navigation, so links in every preview point at `#`.
- **Editing.** The chat is the editor from phase 2. Click-to-edit text in the preview can come later.
- **Free-form HTML.** For Ingrid, a site is hand-written pages, partials, one stylesheet and `site.json`, with blocks for
  data. Themes can come later, as starter pages.
- **Roles:**
  - Admins edit and publish.
  - Members see the draft and History, read-only.
  - The assistant edits the draft for the person using it, only when that person is an admin.
  - MCP gets the read tools and draft edits. It never gets publish, promote, rollback, domains or settings.
  - **`site.json` is person-only.** It holds the form action, redirects and headers, so `site.write`, `site.edit` and
    `site.remove` refuse that path when the caller is the assistant or MCP.
- **The Website item** appears only when the artist's `sites` flag is on (phase 1). It's a new `website` section id in
  `src/schema/sections.ts`.

## Decision 9: commands

Each command has a Zod input schema in `src/server/commands/sites.ts`. The server works out the site from `ctx`, and
every command refuses with 403 when the artist's `sites` flag is off.

| Command | Roles | Assistant / MCP | Phase | Does |
| --- | --- | --- | --- | --- |
| `site.status` | members | yes | 1 | draft changes vs live, recent versions, domains; "shows changed" from phase 3 |
| `site.pages` | members | yes | 1 | list draft files |
| `site.read({path})` | members | yes | 1 | one draft file |
| `site.viewPage({site, n, path})` | members | no | 2 | a published page, prepared for the preview frame |
| `site.write({path, body})` | admins | yes | 1 | create or replace a draft file (sanitized and validated) |
| `site.edit({path, find, replace})` | admins | yes | 1 | a small change; fails unless `find` appears exactly once |
| `site.remove({path})` | admins | yes | 1 | remove a draft file (soft delete; `site.write` on the same path restores it) |
| `site.uploadImage({driveFileId} or {url})` | admins | yes | 2 | add an image original and return its path |
| `site.publish({site})` | admins | **no** | 1 | Decision 3 |
| `site.promote()` | admins | **no** | 1 | Decision 3 |
| `site.rollback({site, n})` | admins | **no** | 1 | Decision 3 |
| `site.reconcile()` | admins | **no** | 1 | Decision 3 |
| `site.domains.add/remove/check` | admins | **no** | 5 | Decision 7 |
| `site.settings.update({autoRefresh})` | admins | **no** | 3 | the auto-refresh switch |

The "no" rows go in `EXCLUDED` in `policy.ts`, and their roles leave out `mcp`. Offering the tools to the assistant in
phase 2 means running `check:roadie:claude` and `check:roadie:vertex`, and adding eval cases such as "make the bio
shorter" and "put the next three shows on the home page".

## Security

- **Separate origin.** Sites are served from their own domains in project `roadie-sites`, never under
  `myroadie.online`. A script on a site's page can't reach the app's cookies.
- **Preview.** The draft shows in an `<iframe srcdoc>` with `sandbox="allow-popups"`, and without `allow-scripts` or
  `allow-same-origin`. It's rendered in `preview` mode, with CSS inlined and images signed. Embeds show as labelled
  placeholders, so check them on staging.
- **Sanitizer.** An allowlist built on `cheerio` (already a dependency), in `src/server/sites/sanitize.ts`. It runs on
  the author's source at every write, and again as render step 1. Generated nodes are inserted after it.
  - It keeps known HTML elements and attributes, the three blocks, and `<iframe>` only from the embed allowlist
    (Spotify, YouTube, Bandcamp, SoundCloud).
  - It removes `<script>`, `<object>`, `<embed>`, `<base>`, `<meta http-equiv>` and `<form>`.
  - It removes every `on*` attribute, `javascript:` URLs, `data:` URLs other than images, `@import` in CSS, and inline
    SVG `<script>` and `<foreignObject>`.
- **Site headers**, in every version's config. The CSP in full:

  ```
  default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; frame-src <embed allowlist>;
  form-action <provider form host, or 'none' until site.json names one>; base-uri 'none'; object-src 'none'; frame-ancestors 'none'
  ```

  - Inline styles are allowed because sanitized CSS can't run code.
  - JSON-LD isn't executed, so `script-src 'none'` doesn't affect it.
  - A render test checks that this CSP allows every URL a rendered page loads.
  - The other headers are `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`.
- **The app's CSP.** Phase 2 adds the app's first CSP, in `next.config.ts` `headers()`. It's only
  `frame-ancestors 'self'`. It has no fetch directives, so the `srcdoc` preview, which inherits it, still renders inline
  CSS and signed images.
- **Tenant isolation:**
  - Every command resolves the site from `ctx.artistId`.
  - `siteDomains` claims stop one artist from taking another's host.
  - The service account that can release every site is used only by server code that has already done that
    resolution.

## Redundancy and failure modes

The main defence is that serving is static and separate from the app. For a failure of Firebase Hosting itself, there
are two more layers.

- **Warm mirror.** A multi-region bucket in `roadie-sites`, `gs://roadie-sites-mirror`, holds every version Roadie
  builds.
  - **Immutable prefixes.** `buildVersion` writes each build to `{hostingSite}/{hostingVersionId}/…`, with pages at
    their clean URL paths, written both as `about/index.html` and as an extensionless `about` object with
    `Content-Type: text/html`, so `/about` is served without a redirect that would expose the prefix. Content types are
    set on every object. Alongside the pages it writes `_serving.json`:
    that version's redirects and headers, including staging's `noindex`. A prefix is written once and never changed, so
    two jobs can't mix their files.
  - **The pointer.** `{hostingSite}/live.json` names the prefix that site serves now, as `{n, hostingVersion}`. Step 5
    of `releaseVersion` writes it, and reconcile keeps it matching Hosting's newest release. It's the only object that
    changes.
  - **Cleanup.** A monthly prune (`scripts/sites-standby.ts --prune`, from a GitHub Actions workflow) deletes a prefix
    only when Hosting no longer holds its `hostingVersion` and no `live.json` names it. Every version that can still be
    rolled back to keeps its standby copy.
- **Standby.** `scripts/sites-standby.ts` builds a global external Application Load Balancer. It's gcloud, kept in the
  repo, and run by a person.
  - **Bucket and CDN:** a backend bucket on the mirror, with Cloud CDN.
  - **Which domains.** The mirror's `domains.json` (`{host → {hostingSite, role: live|www|staging}}`, the same roles
    as `siteDomains`) is written by the
    Domains screen on every add and remove. The script reads it, so it needs nothing from Firestore. A `www` host gets
    a URL-map redirect to its apex, just as Hosting does.
  - **Certificates:** a Certificate Manager map with one certificate per host: the apex, `www.` and `staging.`. Each
    host has its own per-project DNS authorization, with a CNAME (`_acme-challenge_<id>.<host>`) that the Domains
    screen creates and shows at onboarding. So certificates can be issued during an outage, and the CNAMEs don't clash
    with Hosting's records. The phase-5 drill checks that all three hosts get certificates.
  - **URL map:** host rules that rewrite each host to the prefix its Hosting site's `live.json` names. That prefix's
    `_serving.json` supplies the rest: its 301s become `urlRedirect` rules, and its CSP and other headers become custom
    response headers. Nothing is read from Firestore or the app.
  - **Cold** is the default. The standby isn't created, so it costs nothing beyond the bucket. In a Hosting outage, run
    the script. It prints every record to repoint at the load balancer's IP: the apex A record, and the `www` and
    `staging` records (A records in place of their CNAMEs).
  - **Hot** is an option. The load balancer stays up, costing a forwarding rule every month, so failover is just the
    DNS change. A GitHub Actions job re-runs the script's URL-map sync every 10 minutes from the `live.json` files.
    That job, not the app, holds the load-balancer role.
  - **The limit:** failover needs a DNS change at the artist's registrar. It covers domains whose DNS someone on the
    team can change quickly, or that Roadie can change through Domain Connect or Cloudflare. Records are set with
    300-second TTLs.
  - **Drill:** phase 5 runs the standby once for real against the staging domain, and records how long it takes.
- **Scale.** At hundreds of artists, the standby becomes the primary: the load balancer and mirror replace the Hosting
  projects, and `releaseVersion` writes only to the bucket.

| What fails | Public sites | Editing and publishing |
| --- | --- | --- |
| The Roadie app is down, or a bad deploy | Unaffected | Unavailable until it's back |
| Firestore outage | Unaffected | Unavailable |
| One Google region | Unaffected (global CDN, multi-region mirror) | Depends on us-central1 |
| Firebase Hosting outage | Down until it recovers, or until the standby is up and DNS has moved (the drill measures how long) | Releases fail cleanly; reconcile tidies up |
| A bad publish | Wrong until rolled back | History › Roll back; or, if the app is down, the Firebase console (Hosting › Release history), which reconcile records later |
| Shows change while the app is down | A little stale | Refresh runs when the app is back |
| List provider down | The signup form fails; the rest is fine | n/a |
| A Hosting site deleted or misconfigured | Down | `scripts/sites-republish.ts --artist <id> --site live --version <n> [--dry-run]` builds from Firestore sources and releases |

## Testing

- **A fake Hosting API.** `fakes/fake-hosting/` is an HTTP server like the other fakes. It keeps versions, files and
  releases, and can be told to fail any step.
  - `src/server/integrations/hosting.ts` talks to `HOSTING_BASE_URL`. When that's unset, it uses the real
    `https://firebasehosting.googleapis.com`.
  - Dev and tests set it the way the other fakes' base URLs are set: in `.env.development`, `fakes/run-all.ts`,
    `scripts/e2e.ts`, `tests/e2e/env.ts` and `playwright.config.ts`.
  - The images and the mirror use the Storage emulator.
- **Tests.** Render, sanitizer and `blockInputs` are pure, so they go in `tests/unit`. Build, release, lease, reconcile,
  mirror and refresh need Firestore transactions and Storage, so they go in `tests/emulator`:
  - **render:** the author's source is sanitized and the generated nodes survive; partials; canonical and sitemap on
    the production host; no `Disallow` in `robots.txt`; staging config carries `X-Robots-Tag`; the CSP allows every
    URL a page loads.
  - **sanitizer:** one case for each item it removes.
  - **build and release:** deduped uploads; a failure before release; a failure after release, then reconcile; a lease
    conflict; a lost lease leaves the version `pending`, and reconcile settles it; a killed job; a console rollback
    recorded with `sources: null` and pauses refresh; a late-settled old version doesn't move the pointer; a rollback that
    never released isn't marked done; a timed-out release that landed is settled `done`; reconcile holding the lease
    blocks a publish; reconcile brings a stale `live.json` back to Hosting's newest release; a refused rollback doesn't
    delete the version it re-used; the prune keeps every prefix Hosting still holds.
  - **promote and rollback:** same hashes upload nothing; changed shows produce the warning; a retained rollback
    doesn't build; a pruned one does; `sources: null` refuses promote.
  - **restore:** a `sites`, `siteSources` and `siteVersions` doc written by `stampSystem` passes `validateRow`.
  - **refresh:** unchanged `blockInputs` skips; a new show, a cancelled show and a passed date each trigger it; a held
    lease is skipped; **a refresh built before a Publish is refused at step 1 and never undoes it**; a rollback pauses
    refresh until the next publish.
  - **draft:** writing the same path twice updates one doc.
  - **domains:** a second artist's claim is refused; `www` and `staging` are claimed with the apex.
  - **draft:** a removed page's path can be written again.
- **E2E**, on the emulators and fakes. Edit through the chat (fake model) and see the preview update; publish to
  staging; promote; check History; roll back.
- **Phase 1 checks against the real API**, done by hand in `roadie-sites`:
  - an API rollback to an older version;
  - a live version built from staging's hashes uploads nothing;
  - `customDomains` with the app's service account;
  - `retainedReleaseCount` set to 100;
  - the 36-site cap.

## Phases

0. **Before building.** Inventory Ingrid's site: every page and URL (which becomes the 301 map), images, embeds and the
   registrar. Take the Bandzoogle subscriber export. Turn on the nightly Firestore backup.
1. **The publishing spine.** No UI beyond a temporary admin page.
   - **Setup, in order:**
     1. Create `roadie-sites` on Blaze.
     2. Grant the roles in Decision 1, create the mirror bucket, and run `scripts/sites-standby.ts --setup-ci`.
     3. Turn on Firebase Storage for `roadie-prod-iab` if it isn't on. Register the kinds and rules. Add a `storage` key
        for `storage.rules` to `firebase.json`, and extend `scripts/deploy-firestore.ts` to deploy it too.
        - In `scripts/deploy-firestore.ts`, `--only firestore` becomes `--only firestore,storage`.
        - Add `firebaserules.releases.create` (Firebase Rules Admin) to `NEEDS`, because a first storage release
          creates a release rather than updating one.

        Then run `npm run deploy:firestore`.
     4. Run `scripts/sites-create.ts --artist <Ingrid's id>`.
     5. Add the `sites` flag to `platformArtists/{artistId}`:
        - `ArtistFlags.sites` in `src/server/platform.ts`, which `setArtistFlags` and `scripts/platform-config.ts`
          learn to set;
        - the session response that already carries `nestedPaths` carries it too, and `src/lib/auth.tsx` exposes it,
          so the client-side `navFor` shows the `website` section. That needs:
          - `website` in `SECTION_IDS`, `SECTION_LABEL`, `LATE_SECTIONS` and `DEFAULT_HIDDEN` in
            `src/schema/sections.ts`. It stays out of `MEMBER_DEFAULT_HIDDEN` on purpose, because members may read the
            draft and History;
          - an entry in `navFor`'s `all` record and a `sites` option like `fans` in `src/lib/nav.ts`;
          - in `Shell.tsx`, `sites: true` always in `NAV_HREFS` (like `fans: true`), and the flag passed to the main nav
            and to `EditMenuDialog`, so Website can be moved out of More;
          - a `website` icon in `I` in `src/lib/nav.ts`;
        - every `site.*` command and the release route check it on the server.

        Turn it on for Ingrid only.
     6. Push.
   - **Files:**
     - `src/schema/sites.ts`
     - `src/server/sites/{store,render,sanitize,publish}.ts`
     - `src/server/integrations/hosting.ts` and `fakes/fake-hosting/`
     - `src/server/storage.ts`
     - `src/server/commands/sites.ts` (the phase-1 rows of Decision 9) and `src/app/api/sites/release/route.ts`
     - `scripts/sites-create.ts`, `storage.rules`
     - `.github/workflows/site-refresh.yml` and `/api/cron/site-refresh`, running reconcile only in phase 1 (phase 3
       adds the refresh)
   - **Done when** Ingrid's hand-seeded pages publish to `<slug>-staging.web.app`, promote to `<slug>.web.app`, roll
     back, and each version appears in the mirror with `live.json` pointing at the right prefix, with the unit tests green and the real-API checks done. Render in phase 1 covers
     pages, partials, CSS, `site.json`, images and SEO tags; blocks come in phase 3.
2. **The Website section.** The preview, page picker, Draft/Staging/Live switch, Publish dialog, History and Roll back;
   the app CSP, the signed-image route and `site.viewPage`; `site.uploadImage`; and the assistant tools, with checks and evals.
3. **Blocks and refresh.** The three blocks, the refresh step in the existing cron job, and the auto-refresh switch.
4. **The list provider form.** `<roadie-signup>` from a pasted form URL in `site.json`, and Ingrid's subscribers
   imported into the provider.
5. **Cutover.**
   - The Domains screen: manual records, claims and the standby CNAMEs. Connect `ingridavison.com` and `staging.`.
   - The 301 map, the sending records, and the sitemap in Search Console.
   - The standby drill on staging, and the republish script in dry-run.
   - Retire Bandzoogle after a month of clean Search Console coverage.
6. **More artists.** Site creation from Settings and `roadie-sites-N` projects; Domain Connect and the Cloudflare API;
   `ListProvider` adapters (connect, counts, sending records, pushing fan signups); themes as starter pages.

## Decisions taken without asking

They're written down here so Jeff can overturn any of them. Anything that needs Jeff is on the questions page linked
from the issue.

- The data refresh is the one automatic change to public sites. It's on by default and can be switched off.
- The standby is cold by default, with hot as an option.
- Ingrid's site starts as free-form HTML; themes come later.
- Sites are served by Firebase Hosting in a separate project. GitHub is deferred, and Google Sites is rejected.
