# Press module

A proposal, not built. Written as a doc because GitHub Issues is turned off on this repo.

## Why

Roadie tracks booking pitches (venue, promoter, festival edition) but nothing for press: who we asked to cover a release or a show, what we sent them, and what ran. Press needs its own module because the workflow is different from booking:

| | Booking pitch | Press pitch |
|---|---|---|
| Target | A venue, promoter or edition | A person at an outlet (writer, editor, DJ, curator, podcaster) |
| About | A date we want to play | A release, a single, a show or a tour |
| Volume | A few dozen, each worked for weeks | Dozens to hundreds per campaign, most never answer |
| Clock | Open-ended | Hard dates: outlet lead time, embargo, release day, show day |
| Good ending | `booked`, becomes a show | Coverage ran (a URL), or a premiere or interview is scheduled |
| After | Deal, advance, money | Quote for the press kit, share on socials, thank the writer |

So: a separate collection and a separate board, not more `target.kind` values on `pitches` (`src/schema/pitches.ts`).

## What already exists to build on

- **Contacts** (`src/schema/contacts.ts`): per-band people with emails, phones, Instagram, links, and band notes with a "we know them" flag. Press people are contacts. No second people table.
- **Releases and shows**: what a press pitch is about.
- **Email templates, Gmail threads and reply checking** (`emailTemplates`, `emailThreads`, pitch `activity` with `emailSent` / `emailReply`): the same draft, send and follow-up plumbing.
- **Campaigns** (`src/schema/campaigns.ts`): the booking version of "a batch of pitches with a start and an end".
- **Files and Drive folders**: where press photos, the one-sheet and the EPK already live.

## Suggested data model

- **`outlets/{id}`**: a publication, blog, radio station or show, podcast, playlist, newsletter. Fields: name, kind, URL, genres or beats, reach (local, regional, national), city or region for local press, lead time in days, submission method (email, form URL, SubmitHub or Groover, mail a CD), paid or free, notes. Per band, like contacts.
- **Outlet to contact link**: a contact can write for several outlets (freelancers) and an outlet has several contacts. Role on the link: writer, editor, music director, DJ, host, curator.
- **`pressCampaigns/{id}`**: one push. `about` is a release, a show or a tour (exactly one). Key dates: announce date, release or show date, embargo. Holds the angle and the assets used.
- **`pressPitches/{id}`**: one ask to one contact at one outlet, inside a campaign. Fields: `ask` (review, premiere, interview, feature, show preview, listing, airplay, playlist add, session), status, assignee, next step with a due date, last contact, exclusive flag, embargo date, notes. Same `comments` and `activity` subcollections as booking pitches.
- **`coverage/{id}`**: what ran. URL, outlet, contact, date, kind, headline, pull quote, linked release or show, and the press pitch that led to it (optional: unsolicited coverage has none).

Suggested press pitch statuses: `idea` → `toPitch` → `pitched` → `followedUp` → `interested` → `confirmed` (they said yes, with a run date) → `ran` | `declined` | `noReply`.

## Feature ideas

### Core (first slice)

- Outlet list with search and dedupe, linked to contacts.
- Press campaign for a release or a show, with a board of its pitches by status.
- Draft a pitch email from a template with the release or show details and links filled in (private stream link, one-sheet, photos, ticket link). Draft only, as today.
- Log sends and replies from Gmail on the pitch, as booking pitches do.
- "Needs follow-up" list: pitched N days ago with no reply, at most two follow-ups, then `noReply`.
- Coverage log, shown on the release page and the show page.
- Roadie and MCP commands for all of it (`outlets.*`, `press.*`, `coverage.*`).

### Timing

- A press timeline generated from the release date or show date: long-lead print 8 to 12 weeks out, premiere ask 4 to 6 weeks, blogs and playlists 2 to 4 weeks, local show previews and calendar listings 2 to 3 weeks, radio and day-of posts in the last week. Each step becomes a due date.
- Embargo and exclusive handling: one premiere per track, and a warning before pitching a second outlet while an exclusive offer is still open.
- Per-outlet lead time, so "too late for this outlet" shows up before the email is written.

### Local press for shows

- For a show or a tour, suggest the outlets near each city (alt-weekly, daily paper, college and community radio, local blogs, event calendars), from outlets we already have plus the venue's own press list if the venue gave us one.
- One press campaign per tour with a pitch per market, so a 10-city run isn't 10 campaigns.
- Calendar listing submissions as a checklist item per show (many are forms, not emails).

### Assets

- A press kit per release and per band: bio (short, medium, long), photos with credits, one-sheet, private stream link, embeds. One share link to paste into a pitch.
- Track which assets a pitch used, and warn when the photo or bio is older than the release.

### After coverage runs

- Pull quotes collected for the bio, the EPK and booking pitches.
- Turn a coverage item into a draft social post (the `posts` module).
- A thank-you next step for the writer, and a "covered us before" flag on the contact, so the next campaign starts with the warm list.
- Report per campaign: pitched, replied, ran, by outlet kind. Over time, a response rate per outlet and per contact.

### Relationship memory

- On the contact: what they covered, what they passed on, what they like, how they want to be pitched.
- Do-not-pitch flag (asked to be removed, bounced, left the outlet).
- Notice when a contact's address bounces or the reply says they moved on.

### Imports

- CSV import for bought or exported lists (see below), with column mapping, dedupe against existing contacts and outlets, and a `source` on every imported row so a bad list can be found and removed later.
- Paste the URL of a "contact us" or masthead page and have Roadie pull out the outlet and contacts.

### Later, maybe

- A hired publicist as a user with access to the press module only, or a weekly report to send them.
- Radio adds and spins tracking, playlist adds tied to `stats`.
- Coverage alerts: search for the band and release name on a schedule and propose coverage items.

## Buying lists of media contacts

Options, roughly cheapest to most expensive. Prices are from vendor and comparison pages in November 2026 and they disagree with each other, so check before buying.

1. **Build it for free.** Most outlets that cover independent music publish a submissions address. Sources: mastheads and contact pages, bylines on reviews of similar artists (search "<similar artist> review"), college and community radio station sites (music director emails are public), Spotify playlist descriptions, and local alt-weekly contributor lists. Slow, but it has the best reply rate because every row was picked for fit.
2. **Directories sold to musicians.** The Indie Bible (a database of blogs, radio, playlists and labels by genre and region; price not checked), Music Connection's annual directories, and bundles such as "3,000+ music blogs" sold on small storefronts. Quality varies a lot: many dead blogs and general inboxes. Ask how recently it was verified and whether it exports to CSV.
3. **Playlist curator finders.** PlaylistSupply (from about $20 for the first month), Chartmetric and artist.tools: search playlists by genre and get the curator's contact where one is public. Subscribe for a month, export what the terms allow, cancel.
4. **Pay-per-pitch platforms (you rent access, you don't get the list).** SubmitHub (about $1 to $4 a submission), Groover (about €2 a contact), Musosoup (about £36 a campaign once accepted). You never see an email address, but you get an answer and learn which outlets like the music. Useful for finding outlets worth adding to Roadie by hand afterwards.
5. **Professional media databases.** Muck Rack and Cision: journalists with beat, recent articles and email. Annual contracts only, estimated at roughly $7,000 to $10,000 a year, and the database isn't sold on its own. Cheaper tools with a media database include Prowly and Prezly. Realistic only through someone who already has a seat.
6. **Hire a publicist or a radio promoter.** You're paying for their list and their relationships. Indie campaigns run about $500 to $1,500 at the low end and $1,500 to $5,000 typical, for 4 to 6 weeks. Ask for the report of who was pitched and what ran, and whether you can keep it: that report is a list.

### Before buying or importing any list

- Check the date it was last verified and ask for a sample in our genre. An old list is mostly bounces.
- Prefer named people with a beat over `info@` and `submissions@` rows.
- Cold email to a bought list is legal in the US under CAN-SPAM if it's honest, has a postal address and honours opt-outs. It is much more restricted for EU, UK and Canadian recipients (GDPR, PECR, CASL). This is not legal advice.
- Send from Gmail one at a time, personalised, and never bulk-BCC a bought list: bounces and spam reports hurt the band's sending domain, which also carries booking email.
- A bought list is a starting list of outlets to research, not a send list. Import, mark the source, then prune to the ones that fit.

Sources for the prices: [Groover pricing](https://groover.co/lp/pricing), [Musosoup pricing](https://musosoup.com/pricing), [Groover vs SubmitHub](https://musosoup.com/blog/groover-vs-submithub), [playlist pitching services compared](https://orphiq.com/resources/playlist-pitching-services-compared), [PlaylistSupply](https://playlistsupply.com/blog/playlist-curator-contact-guide/), [Prowly on Cision and Muck Rack](https://prowly.com/magazine/?p=13772), [music PR cost](https://amworldgroup.com/pricing/music-pr-cost).

## Open questions

- Are outlets per band (like contacts) or shared across bands (like a venue's public facts)? Suggested: per band to start.
- Does a press contact need anything a contact doesn't have (beat, preferred pitch method), or do those live on the outlet link?
- One campaign per release, or separate campaigns for each single and the album?
- Does the first slice cover shows and releases both, or releases first?
- Who sees press: admins only, like booking pitches, or the whole band?
