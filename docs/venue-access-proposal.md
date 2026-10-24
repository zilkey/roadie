

# Venue Access Proposal
 · 

## Summary
Split each venue into two documents: a shared directory record at `venues/{id}` that every signed-in band user can read, and a per-band private record at `venueNotes/{artistId}__{venueId}` that only that band's admins can read. Firestore rules work per document, not per field, so the only way to make name and address readable while load-in notes, contacts and private notes stay locked is to store them in different documents. Writes stay server-only through `db.ts`, so dedupe, history and undo keep working, and the change is a migration script plus rules, schema, a handful of commands and one page.
Any signed-in admin or member can edit the shared record, after a confirmation that the change reaches every band. Duplicates are fixed with a new "Merge into" command instead of an archive-for-everyone, and history on private notes is limited to that band's admins.

## Where we are today
A venue is one document, `venues/{id}`, and only admins can read it (`firestore.rules`, the admin-only block). Members cannot open a venue at all, and the rules are not partitioned by artist yet: an admin of any artist in your claim reads every venue. All writes already go through the server (`src/server/db.ts`), so rules only govern reads.
 | 
Field on `venues/{id}` today | 
What it is | 
Who should see it
 | 
name, type, address, region | 
The room and where it is | 
Every signed-in user
 | 
capacity, ages, website, instagram | 
Public facts about the room | 
Every signed-in user
 | 
sound (provider, notes) | 
What the house provides | 
Every signed-in user
 | 
matchKey, sources | 
Dedupe key and where facts came from | 
Every signed-in user (server uses matchKey)
 | 
loadInNotes, notes | 
The band's own experience there | 
That band's admins
 | 
contactIds, promoterIds | 
The band's relationships | 
That band's admins
Things that depend on the venue document and will feel the change:

`useBooking()` in `src/components/booking/common.tsx` loads the whole `venues` collection on the client for the Booking list, venue page, show form and pickers.

Shows keep a copy of the venue (`show.venue`: id, name, address, city), refreshed by `src/server/denorm.ts` when name or address change. Members already read that copy.

`shows.create` reads the venue for its default sound and seeds the private show deal's `contactIds` from the venue's `contactIds`.

Pitches target a venue by id and carry `artistId` already. Promoters and editions hold `venueIds`.

`db.ts` dedupes venue creates on `matchKey` (name + city), and the import script and MCP tools rely on that merge.

Rules tests in `tests/unit/rules.test.ts` list `venues` among the admin-only collections.

## Requirements
Three audiences, read from the ask. "Public" here means any signed-in app user, never the open internet: nothing in Firestore is readable without a session, and the AI-only login (empty `artists` claim) still reads nothing.
 | 
Who | 
Shared venue facts (name, address, type, region, capacity, ages, website, instagram, sound) | 
A band's private venue data (load-in notes, notes, contacts, promoters)
 | 
Signed out, not invited, AI-only login | 
No | 
No
 | 
Member of any artist | 
Read, create and edit, with a confirmation | 
No
 | 
Admin of artist A | 
Read, create and edit, with a confirmation; merge duplicates | 
Read and edit artist A's only
 | 
Admin of artist B | 
Read, create and edit, with a confirmation; merge duplicates | 
Never sees artist A's
 | 
MCP and Roadie, acting for an artist | 
Same as that artist's admin | 
Same as that artist's admin
Two consequences worth stating. A member can now open the venue behind a show, see its address and house sound, and fix a mistake in it. And two bands that both play Hi-Dive share one directory record, so a capacity fix by one band is seen by the other; that is the point, and the confirmation says so. Their notes, contacts and promoters never cross.

## Proposed data model
One shared document per room, plus one private document per band that has anything to say about it. The private document's id is `{artistId}__{venueId}`, the same trick `showDeals/{showId}` uses, so the venue page fetches it by id with no query.
Members reach only the shared record. Each band's admins reach the shared record and their own notes, and the rules give them no path to the other band's.
 | 
Collection | 
Document | 
Fields | 
Read rule
 | 
`venues` (unchanged path) | 
`venues/{venueId}` | 
name, type, address, region, capacity, ages, website, instagram, sound, matchKey, sources, common stamps | 
Any admin or member of any artist; soft-deleted ones admins only
 | 
`venueNotes` (new) | 
`venueNotes/{artistId}__{venueId}` | 
artistId, venueId, loadInNotes, notes, contactIds, promoterIds, common stamps | 
`roleIn(artistId) == 'admin'`
Decisions inside that split:

Shared facts live on the shared doc only. `sound` stays shared: whether the house has a PA is a fact about the room, and `shows.create` reads it for the default. If a band wants private sound notes they go in `loadInNotes`.

`sources` stays shared. They document the shared facts (website, capacity) and hold only URLs and dates.

`contactIds` and `promoterIds` move to the private doc. Contacts and promoters are admin-only booking data that is not partitioned by artist yet, so moving the links keeps today's privacy and leaves the door open to partition those collections the same way later.

Dedupe stays on the shared doc. `matchKey` (name plus city) is global, which is what you want: a second band adding Hi-Dive merges into the same room.

A private doc is created lazily, the first time a band writes a private field, links a contact or promoter, or flags the venue. Most rooms in the directory will have none.

Archiving is per band; duplicates are merged. `venues.remove` soft-deletes the band's `venueNotes` doc and hides the room from that band's lists; the shared doc stays for everyone else. There is no archive-for-everyone. A duplicate or closed-and-reopened room is fixed with `venues.mergeInto` (App changes), which moves every band's references onto the surviving record.

Schema: `Venue` loses the four private fields; a new `VenueNote` entity in `src/schema/venueNotes.ts` carries them with `artistId` and `venueId`. `VenueInput` for `venues.create` and `venues.update` keeps accepting all the old fields so MCP, Roadie and the import script keep working; the command splits them across the two writes in one `run`.

## Firestore rules
Two new rules, one tightened rule and one new helper in `firestore.rules`. Writes stay denied for every client. The private rule reads the artist id straight off the document, which is the pattern the file's own TODO asks for once records carry `artistId`.
Why each line is shaped that way:

`venues` reuses `band()` (admins, or members on live docs), so a member who lists venues for a show sees exactly the live directory and an admin can still find an archived room. `appUser()` is the same test spelled for readers of the rules; use whichever reads better in the file.

Editing is a command permission, not a rule. Rules only govern reads here. `venues.create` and `venues.update` open to the `member` role on the server, and the command refuses private fields from anyone who is not that artist's admin.

`venueNotes` checks the per-artist role, not the best role. An admin of artist B who is a member of artist A gets `member` for A and fails. This is the first collection that uses `roleIn(resource.data.artistId)`, so it needs its own test cases.

List queries pass only when constrained. The client must query `venueNotes` with `where('artistId', '==', artistId)`; an unfiltered listing fails the rule, which is the behaviour you want. The venue page reads one doc by id, which the rule evaluates on that document.

History is tightened now. `db.ts` stamps `artistId` on every new history entry: the record's artist when it has one, null otherwise. So `venueNotes/A__x/history` is readable only by A's admins, and pitches, shows and show deals tighten in the same change for free. The Admin History page queries the `history` collection group, so it runs two queries, `artistId == <this artist>` and `artistId == null`, and merges them by time. Firestore does not match a missing field with `== null`, so the migration backfills `artistId` on every existing entry.
Rules tests to add in `tests/unit/rules.test.ts`, each one line with the existing helpers:

member (`david`) reads `venues/x` and fails on `venueNotes/x__x`

`otherAdmin` (artist y) reads `venues/x`, fails on `venueNotes/x__x`, reads `venueNotes/y__x`

a user who is member of x and admin of y fails on `venueNotes/x__x` (best role must not leak)

`anon`, `noRole`, `aiLogin`, `legacyAdmin` fail on both

member fails on a soft-deleted venue, admin reads it

a member's `getDocs(collection('venueNotes'))` fails, and `where('artistId','==','x')` as admin of x succeeds

move `venues` out of the admin-only `ALL` expectations into a new `SIGNED_IN_READS` list
History tests to add with them:

admin of x reads `venueNotes/x__v/history/000001` stamped `artistId: 'x'`; admin of y and a member of x fail

any admin reads a `venues/v/history` entry stamped `artistId: null`; a member fails

a collection-group query on `history` with `artistId == 'x'` succeeds for admin of x and fails for admin of y; an unfiltered one fails for both

## App changes
The work touches one schema file, three commands, one loader, one page and the tests. Nothing in the show, pitch, promoter or contact pages changes shape; they keep reading `venues` and ids.
 | 
Area | 
Change
 | 
`src/schema/venues.ts`, new `src/schema/venueNotes.ts` | 
`Venue` drops loadInNotes, notes, contactIds, promoterIds and gains optional `mergedInto`. `VenueNote` = entity with artistId, venueId and those four. `VenueInput` keeps every field so callers do not change.
 | 
`src/server/db.ts` | 
Register `venueNotes` (no dedupe, `artistId` required). Stamp `artistId` (or null) on every history entry.
 | 
`venues.create` / `venues.update` | 
Roles become admin, member and mcp. Split the input: shared fields to `venues`, private fields to `venueNotes/{ctx.artistId}__{id}` in the same `run`. A member sending any private field gets a 403 naming the fields. `ctx.artistId` is already on every app, MCP and Roadie call; scripts fall back to the one artist.
 | 
`venues.remove` | 
Admin only. Soft-delete the band's `venueNotes` doc so the room leaves this band's lists. The shared doc is never archived by this command.
 | 
New `venues.mergeInto` `{from, into}` | 
Admin and mcp. In one `run`: repoint `show.venue`, pitch targets, promoter `venueIds` and edition `venueIds` from `from` to `into`, for every artist; move each artist's `venueNotes` (when both exist, join the notes and union the ids); fill empty shared fields on `into` from `from`; soft-delete `from` with `mergedInto: into`. One History run, so Undo reverses it. The server writes other artists' records but never returns their private content to the caller.
 | 
`contacts.attach` / `contacts.detach`, `syncVenuePromoters` | 
Write links to the band's `venueNotes` doc instead of the venue. Promoter `venueIds` stays on the promoter (admin-only today).
 | 
`shows.create` | 
Seed the deal's `contactIds` from the band's `venueNotes` doc, not the venue. Sound default still from `venues`.
 | 
`src/server/denorm.ts` | 
Unchanged: name and address still live on `venues`.
 | 
`useBooking()` in `src/components/booking/common.tsx` | 
Add `venueNotes` with `where: [['artistId','==',artistId]]`, keyed by venueId, and merge for the Booking list (a room with notes, contacts or shows for this band shows first).
 | 
Venue page `booking/venues/[id]/page.tsx` | 
Read both docs. Drop `AdminOnly` on the page. Two cards: "About the room" (shared, everyone, editable) and "Our notes" (private, admins). Private notes keep autosave. Shared facts switch to an explicit Save, because autosave cannot ask first.
 | 
Shared-edit confirmation | 
Save opens a dialog: "This updates Hi-Dive for every band that uses Band Tracker. Your name is recorded in its history." It lists the fields changed, before and after, with Save for everyone and Cancel. Adding a new venue shows a lighter line: "Other bands will see this venue's name, address and details."
 | 
Merge UI | 
On the venue page for admins: "Merge into another venue…" opens a venue search, then a confirmation naming both rooms and saying every band's shows, pitches and notes will move. A merged venue's URL redirects to the survivor.
 | 
Show page for members | 
Link the venue name to the venue page now that they can read and fix it.
 | 
MCP (`mcp/tools.ts`) and Roadie (`src/server/assistant/tools.ts`) | 
`records.get('venue')` returns the shared doc plus the caller's `venueNotes` merged. Tool descriptions for `venues.update` say a shared edit changes the room for every band. Roadie asks the user to confirm a shared edit, using the confirm card it already has. Expose `venues.mergeInto` to MCP and Roadie behind the same confirm card.
 | 
Admin History page | 
Two collection-group queries (this artist, and null) merged by time, so it passes the tightened rule.
 | 
`scripts/import-booking-kit.ts`, `scripts/seed.ts` | 
Keep calling `venues.create` with the full shape; the command does the split. Seed a second artist with its own notes on a shared room, and a duplicate venue to merge, so tests can prove isolation and merging.
 | 
Backup and restore | 
New top-level collection is picked up automatically (one file per collection). Add `VenueNote` to the restore validator's schema map.
 | 
Tests | 
Rules and history cases above. `tests/unit/booking.test.ts` for the split create and update, a member's shared edit allowed and private edit refused, remove, attach, and mergeInto across two artists with Undo. E2e: a member opens a venue, sees the address but no notes, fixes the capacity through the confirmation; an admin of another artist sees the fix but no notes.

## Migration
The order matters because rules are per document: opening `venues` to members before the private fields are gone would leak them for the gap. So the fields move first and the rules widen last. Today there is one artist per project, so every existing venue's private fields belong to that artist.

Take a backup (`npm run backup`), as `docs/BACKUP.md` describes.

Deploy code that reads both documents, tolerates a missing `venueNotes` doc, stamps `artistId` on new history entries, and runs the History page's two queries. Commands write to both documents from this point on. Rules unchanged: venues are still admin-only, so nothing is exposed yet, and member edits stay off until step 5.

Run `npm run migrate:venue-notes` (new script next to `migrate-artists.ts`): for each venue with any private field set, write `venueNotes/{artistId}__{venueId}` through `db.ts` under one `runId`, then remove the four fields from the venue. Flags: `--dry-run`, `--artist=<slug>` when more than one, `--yes` for real Firestore. Idempotent: a venue whose fields are already gone is skipped. One History run, so Undo can reverse it.

In the same script, backfill `artistId` on every existing history entry: the parent's `artistId` when it has one, otherwise null. This writes history directly, like `migrate-history.ts`, and is not itself logged.

Add the rules tests, then deploy `firestore.rules` with the widened `venues` read, the new `venueNotes` rule and the tightened history rule. Turn on the member role for `venues.create` and `venues.update` in the same release.

Remove the private fields from the `Venue` schema so the restore validator and strict parsing reject the old shape going forward.
Rollback at any step before 5 is Undo on the migration run. After 5, rolling back the rules alone is enough to close reads again; the data split is harmless to keep.

## Alternatives considered
 | 
Option | 
Why not
 | 
One document, hide private fields in the UI | 
Rules cannot hide a field. Any member or other band's admin could read the whole venue with the SDK. Fails the "locked by Firestore permissions" requirement.
 | 
Serve venues from an API route that strips fields | 
Keeps one doc but gives up live subscriptions (`useDoc`, `useCollection`) for this one collection, and the data is still open in Firestore to anyone with a token. Rules are the lock, not the server.
 | 
Subcollection `venues/{id}/bands/{artistId}` | 
Equivalent safety; the rule can check the path instead of a field. Rejected for consistency: pitches and shows already use a top-level collection with `artistId`, the rules TODO asks for that pattern, and listing a band's notes is a plain `where` instead of a collection-group query and index. Fine to switch if you prefer it.
 | 
Per-band venue copies (`artistId` on `venues`) | 
No shared directory, so the name and address requirement is not met; dedupe by `matchKey` would have to become per artist; two bands maintain two Hi-Dives.
 | 
Keep `contactIds` and `promoterIds` on the shared venue | 
Leaks who a band talks to. Contacts and promoters are admin-only and unpartitioned today; putting the links on the private doc keeps today's privacy and prepares the same split for those collections.

## Decisions
Jeff answered the open questions on 2026-10-23. The sections above reflect these answers.
 | 
Question | 
Decision
 | 
Which fields are shared | 
All of them as proposed: name, type, address, region, capacity, ages, website, instagram and house sound.
 | 
Can members edit shared facts | 
Yes. Any signed-in admin or member can create and edit the shared venue record, for the benefit of every band. Saving asks for confirmation first.
 | 
Can any band's admin edit shared facts | 
Yes, the same rule as members: anyone signed in, with confirmation, and History records who made the change.
 | 
Who edits private details | 
Only that band's admins. Contacts and promoters stay admin-only and are not split for now.
 | 
Duplicates and closed rooms | 
A "Merge into" command replaces archive-for-everyone. Each band can still hide a room from its own list.
 | 
History on private notes | 
Tighten it now: history entries carry the artist id and only that artist's admins read them.