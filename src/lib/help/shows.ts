import type { HelpTopic } from "./types";

/** Help text for the Shows pages, setlists, songs, money, checklists, custom fields and rehearsals. Each sentence is checked against the UI code. */
export const SHOW_TOPICS: HelpTopic[] = [
  {
    id: "upcomingShows",
    title: "Shows: Upcoming tab",
    text: [
      "The Upcoming tab lists shows still ahead, soonest first. The tab label carries the count, like \"Upcoming · 4\".",
      "A show is either a Hold (penciled in, not locked) or Confirmed (it's happening). A hold whose date passes without being confirmed moves to Dropped. A confirmed show whose date passes moves to Played.",
      "Columns: Date (opens the show), Venue, Address (opens Google Maps), Load in, Sound check, Doors, Show starts, Downbeat, Sound (\"We provide\" or \"They provide\"), Contact (the day-of contact) and Setlist (song count and length, opens the setlist).",
      "Admins get a \"New show\" button.",
    ].join("\n\n"),
    related: ["showPage", "playedShows", "droppedShows", "canceledShows", "booking"],
  },
  {
    id: "playedShows",
    title: "Shows: Played tab",
    text: [
      "The Played tab lists shows that happened, newest first. A show counts as played once its date has passed while Confirmed, or once it was marked played.",
      "Columns: Date, Venue and Duration (the set length). Admins also see Total income and Total expenses for each show; members don't see money.",
      "It shows 50 at a time. Press \"Show 50 more\" for older ones. Admins also get a footer with the income and expense totals of the rows loaded so far.",
      "Open a show to see its Finances tab or fill in the \"How'd it go?\" page.",
    ].join("\n\n"),
    related: ["showPage", "income", "expenses", "money", "upcomingShows"],
  },
  {
    id: "canceledShows",
    title: "Shows: Canceled tab",
    text: [
      "The Canceled tab lists shows the venue (or the other side) called off, newest first. Columns: Date, Venue and Reason.",
      "The reason is whatever an admin typed (optional) when changing the show's status, so it's often blank (a dash).",
      "A canceled show comes off Bandsintown. Its event stays on the band calendar until an admin presses \"Remove from calendar…\" under Where & when. To cancel one, an admin opens the show and presses the status pill beside the title, which opens \"Change status\". Pick Canceled and press \"Change to Canceled\". Dropped is the other way round: we pulled out.",
    ].join("\n\n"),
    related: ["droppedShows", "upcomingShows", "showPage"],
  },
  {
    id: "droppedShows",
    title: "Shows: Dropped tab",
    text: [
      "The Dropped tab lists shows we pulled out of, newest first. Columns: Date, Venue and Reason. Canceled is the opposite: the venue called it off.",
      "A hold whose date passed without ever being confirmed also lands here, with no reason (a dash).",
      "To drop a show, an admin opens it, presses the status pill beside the title, picks Dropped and presses \"Change to Dropped\", with an optional reason. A dropped show comes off Bandsintown; take its event off the band calendar with \"Remove from calendar…\" under Where & when.",
    ].join("\n\n"),
    related: ["canceledShows", "upcomingShows", "showPage"],
  },
  {
    id: "showPage",
    title: "A show's page",
    text: [
      "A show's page has four tabs: \"Show Details\", \"Setlist\", \"Promotion\" and \"Finances\". The title shows the venue and date, with a status pill (Hold, Confirmed, Played, Canceled or Dropped). Admins can press the pill to change status. There is no page-wide Edit: tap a value on a card to change it, and it saves when you leave it.",
      "Show Details has the cards: \"Where & when\" (venue, map link, times, day-of contact, and \"Add to calendar…\", which previews the event and its invites before sending it to the band calendar; saving a show never changes the calendar. Admins press the pencil to change the venue, date or kind of show: it saves as you go and Done closes it. Tap a time or the set length to change it; it saves when you leave it. A new show starts with the venue's day-of contact; tap the day-of contact to pick someone from the venue, \"Someone else…\" (added to the venue's contacts as a day-of contact) or None), \"Who's playing\" (billed as, players, \"Ask who's free\"), \"Sound\", \"Stage plot\" and, for admins, \"Custom fields\".",
      "In Who's playing, admins tap a person to put them on the show or take them off; it saves at once. Picking a lineup under \"Billed as\" fills in its players. \"Ask who's free\" sits in the card's header, and the answers show under the players.",
      "The Promotion tab has \"Posters\" and \"Promotion\". Anyone in the band can \"Upload a poster\" (a picture or PDF): it goes into the show's own Drive folder, named with the date and venue inside the Shows folder chosen on Settings > Google (made on the first upload and linked from the card), shared with the band. Remove takes a poster off the show and leaves the Drive file alone. In the Promotion card, admins tap the ticket link to change it (it saves when you leave it), add a doc with the plus beside Docs and take one off with its ×. Admins can also \"Publish to Bandsintown\", \"Take off Bandsintown\" or \"Sync Bandsintown now\". Only Confirmed shows get listed.",
      "Checklists sit beside every tab, and Comments are at the bottom.",
      "\"How'd it go?\" is a separate admin page for a show that's happened: star ratings for the show and venue, crowd, paid attendance and notes. Saving it marks the show played.",
    ].join("\n\n"),
    related: ["setlists", "income", "expenses", "checklists", "customFields", "upcomingShows"],
  },
  {
    id: "setlists",
    title: "A show's Setlist tab",
    text: [
      "The Setlist tab is that show's own list of songs and breaks. It saves by itself as you change it, with a saved/saving status beside the buttons.",
      "Admins start one with \"Seed from template\" or \"Copy from another show\". If the list already has songs, you choose \"Add to end\" or \"Replace list\". The result is a copy: later edits to either side don't change the other.",
      "\"+ Song\" lists only songs that are Playing or Learning. \"+ Break\" adds a named break with a length (default \"Talk / tune\", 1:00). Drag to reorder; the ✕ removes an item. Members can read it.",
      "\"Alt\" on a song opens a song search: the song you pick is pinned under it in orange as an alternate, and drags with it. A song can have several; ✕ removes one. Alternates don't count toward the running time. Seeding or copying a list brings its alternates, and Print has an \"Alternates\" box to print them under their songs.",
      "The total card compares the list's running time with the show's set length (from Where & when): \"Fits\", or how much it runs over.",
    ].join("\n\n"),
    related: ["setlistTemplates", "songs", "showPage"],
  },
  {
    id: "setlistTemplates",
    title: "Setlist Templates",
    text: [
      "The Setlist Templates page (/setlists) lists reusable setlists, each with its song count and running time. A template is a starting point: on a show's Setlist tab you can \"Seed from template\" to copy it into that show.",
      "Admins make one by typing a name under \"New template name…\" and pressing Create. Open a template to edit it: songs and breaks are added, reordered and removed the same way as on a show, and the name and list save by themselves.",
      "Editing a template later doesn't change setlists already made from it. \"More\" has \"Archive template\".",
    ].join("\n\n"),
    related: ["setlists", "songs", "rehearsals"],
  },
  {
    id: "songs",
    title: "Songs",
    text: [
      "The Songs page lists every song in tabs with counts: Playing, Learning, Retired, Unlinked (no Drive file yet) and, last, Writing: songs still being written. \"Add a song\" on the Writing tab starts the song in the Writing phase. Use \"Search songs…\" to filter by title or writer. Columns: Title, Key, Time and Lyrics. A ♪ means the song has a recording. Admins get \"Add a song\", which searches Drive for audio, video and docs as you type the title.",
      "A song's page shows its status, key, BPM and length, plus Details (written by, last rehearsed, notes and any custom fields). Admins tap a value to change it; it saves when they leave it. \"More\" has \"Archive song\".",
      "\"Charts & recordings\" lists the song's files and links, grouped as Charts, Demos, Recordings, Rehearsal takes, Lyrics, Stems and Other. Audio and video have a Play button. Admins use \"+ Add from Drive\", \"Upload a demo\" (it goes in the Demos folder chosen on Settings › Google, shared with the band, and shows under Demos), (on a Writing song it is \"Upload audio\" and goes in the Songwriting folder instead), and \"Run sharing check\" to flag files the band can't open or that sit outside the band folder. \"Copy to band folder\" puts a shared copy in the Charts folder (lyrics, chord sheets), chosen on Settings › Google.",
    ].join("\n\n"),
    related: ["setlists", "customFields", "rehearsals"],
  },
  {
    id: "income",
    title: "A show's money",
    text: [
      "A show's Finances tab has two admin cards, \"Money in\" and \"Money out\", and the Net card under them. Money in lists the show's income: \"Owed to us\" or \"We got it\", what for (Guarantee, Door, Tips, Merch, Streaming, Sync, Grant, Gear sale or Other), who from, the amount, and when it's received and how (Cash, Venmo, Check, Square, Card, Bank or Other). A line marked \"Owed to us\" has a \"Received\" button. \"+ Money in\" opens the form; on a show it doesn't ask for a project or show, since the record is the show's. Income doesn't need a show: Bandcamp sales or a grant go on the Money page.",
      "Money out lists everything going out or still owed on the show: expenses (including bandmates' pay-back ones), open bills and payouts. \"+ Money out\" asks \"We owe\" or \"We paid\", the category (an autocomplete; Gas is its own category with its own form, see Expenses), To (type a name: band people, players, contacts, or keep what you typed), the amount, what for, and for \"We paid\" who paid (an admin, from their own account: the band has no account), when, and for a payout how. An unpaid payout shows \"We owe\" with a \"Mark paid\" button. \"Split evenly\" proposes one unpaid payout per player on the show from what's left after expenses; edit the amounts and press \"Add payouts\".",
      "The show's money lands on its project: a new show takes its configuration's project (Full band goes to General, Duo to Duo). The Net card adds up In, Out, Net to the project, Still owed to us and We still owe. Members don't see these cards; they keep their own expenses card on the show.",
      "Every record counts, received or paid or not. The totals feed the Played tab and the Money page.",
    ].join("\n\n"),
    related: ["expenses", "payouts", "money", "projects", "playedShows", "showPage"],
  },
  {
    id: "payouts",
    title: "Payouts and what we owe",
    text: [
      "A payout is money the band pays a person: \"Pay for playing\", \"Another band's cut\", \"Paid back\" (an expense reimbursed) or \"Other\". It goes to a band member, a player, a contact or just a name. Until it's marked paid it counts as \"We owe\"; once paid it records how (Cash, Venmo, Check...), when, and which admin paid it from their own account. A \"Paid back\" payout is never listed on its own: the expense it paid back says who paid whom back and when.",
      "Admins add them with \"+ Money out\" on a show's Finances tab, a rehearsal (a room rental paid to a person, or a sub's pay for the night), a release or a release track (a session player's pay for one song), or the Money page. Choosing the \"Reimbursable expense\" kind in Money out is not a payout at all: it saves an expense in that person's name with pay back on, the same record they'd make themselves (\"we owe Eric $42 for gas\").",
      "On the Money page, \"We owe\" groups unpaid payouts, unpaid bills and unpaid pay-back expenses by person. Pay-back expenses get a \"Pay\" button that opens Money out on \"We paid\" with their items ticked; a bill or a payout gets \"Mark paid\", which asks who paid and when. Paying someone back marks their expenses paid back and writes one \"Paid back\" payout listing them.",
      "Members see only the payouts made to them, as \"Paid to me\" on My money, and only once they're paid.",
    ].join("\n\n"),
    related: ["income", "expenses", "money", "projects"],
  },
  {
    id: "projects",
    title: "Projects",
    text: [
      "A project is a bucket money belongs to: General (the default, made with the band), Duo, a release, a tour, a music video, or anything else. Every income, expense and payout is on exactly one project; a record with none counts as General. A show has a project too, set from its configuration, and its money lands there.",
      "Admins see the Projects tab on the Money page: a table of Project, Kind, In, Out and Net, with closed projects folded away. \"New project\" asks for a name and kind, and saves with \"Add\". A project page shows Spent, In so far, Net (owed amounts included), We owe, Money in and Money out tabs and spent by category; a show that hasn't happened yet stays out of Money in and the tiles until its date; its name edits in place, and each record's name, amount and project edit in place (a record that belongs to a show links to the show instead of editing its name here), and the ⋯ menu has \"Close project\" (it stays readable but takes nothing new), \"Make default\" (new money with no project lands here) and, only while nothing is on it, \"Delete project\". A project with money on it is never deleted.",
      "Members see the list too, just names and kinds, so they can pick a project when they add an expense.",
      "A release has a project of its own, made with it: the release's Money tab is that project's money. Tours aren't attached to projects yet. A rehearsal's money goes on the project its When & where card names (General until changed), and changing that project moves the rehearsal's expenses and payouts with it.",
    ].join("\n\n"),
    related: ["money", "income", "expenses", "payouts"],
  },
  {
    id: "expenses",
    title: "Expenses",
    text: [
      "An expense is something bought or a bill: who was paid (the vendor, \"To\") and who paid it from their own account. Admins add them with \"+ Money out\" on a show's Finances tab, a rehearsal, a release or a release track, or on the Money page, where \"We owe\" logs a bill nobody has paid yet and \"We paid\" asks who paid and when. A bill shows \"We owe\" until \"Mark paid\" names the payer and the date. Members add their own on their expense page and the show's Expenses card.",
      "The Category in Money out is an autocomplete: Gear, Gas, Travel, Lodging, Food, Recording, Mixing, Mastering, Pressing, Artwork, Photo, Video, Room rental, Marketing, Fees or Other. Travel is flights, tolls and parking. Gas is fuel and has its own form: pick who drove, and their saved home is the From (shown as their name's home with the address; if they have no home saved, type or paste one and tick \"Save as their home\"). To comes from the rehearsal's location or the show's venue. Miles times MPG times the local gas price gives an estimate, which you can overwrite. The receipt sits behind an \"Add receipt\" link. Gas is always paid back, so it has no checkbox.",
      "\"Add an expense\" for members has an Amount, category chips, What for, a Project (open projects; it picks the show's project, else General), an optional show, \"The band should pay me back\" (on by default) and \"Attach receipt\" (a Google Drive link). It's saved with the Save button.",
      "A pay-back expense shows \"waiting\" until an admin pays it back (\"Pay\" on the Money page, or Money out with \"We paid\" and \"Reimbursable expense\"); then it shows \"paid back\" with the date and is locked. One with pay back off shows \"no pay back\": the band's own money paid it. Members only see and add their own; they can change an expense's project until it's paid back.",
    ].join("\n\n"),
    related: ["money", "income", "payouts", "projects", "rehearsals", "showPage"],
  },
  {
    id: "money",
    title: "Money",
    text: [
      "For admins, the Money page has tabs Overview, Projects, By show and By category, with \"+ Money in\" and \"+ Money out\" at the top. Overview shows In (income received), Out (expenses and payouts actually paid) and Net, then Owed to us, We owe and \"Net once everything settles\", with a month chart of money that moved; \"Expected\" (guarantees booked for shows not played yet, counted nowhere else until the date passes); \"Owed to us\" (income not yet received, each with \"Received\"); \"We owe\" grouped by person (unpaid payouts, bills and pay-back expenses, with \"Pay\" or \"Mark paid\"); \"Recently\"; and \"Open projects\" with each project's net. A project page adds \"Who paid\" beside \"Spent by category\".",
      "The money on a show, a rehearsal, a release and a release track is the same two cards: \"Money in\" and \"Money out\" (a rehearsal has Money out only). Their forms are the same as the Money page's, opened on that record.",
      "\"By show\" charts each show's take and \"By category\" breaks it down by category (payouts count as \"Paid out\"). Nothing is a bank balance: the app records how money moved (Cash, Venmo, Check...), not which account it sits in.",
      "For members, the page is \"My money\": \"The band owes you\" (their unpaid pay-back expenses), \"My expenses\" with a status (waiting, paid back on a date, or no pay back), \"Paid to me\" (payouts to them, once paid), a \"Projects\" link and \"Add an expense\". They can edit or remove an expense until it's been paid back.",
    ].join("\n\n"),
    related: ["income", "expenses", "payouts", "projects", "playedShows"],
  },
  {
    id: "checklists",
    title: "Checklists",
    text: [
      "Each show has a \"Checklists\" column beside its tabs, with a count like \"3 of 9\". A list is a named set of to-dos. Anyone in the band can tick items, add one (\"Add a to-do…\"), edit it and assign it to a person (or leave it for \"Anyone\").",
      "Admins press \"New list\" to start from a template or a \"Blank list\", and use the list's menu to rename or delete it. \"Edit\" reorders lists once there are two or more.",
      "Templates are managed in Artist settings, General, under \"Checklist templates\" (\"Manage templates\" links there). Adding a template to a show copies its items unticked and unassigned. Later template edits don't change lists already on shows.",
      "\"Save as template\" on a list makes a new template from it. If the list came from a template, the button reads \"Update template\" and replaces that template's items (after a confirm).",
    ].join("\n\n"),
    related: ["showPage", "customFields"],
  },
  {
    id: "customFields",
    title: "Custom fields",
    text: [
      "Custom fields are the band's own extra facts, each a label with a text value: Capo or Tuning on songs, Parking or Hotel on shows.",
      "Admins define them in Artist settings, \"Custom fields\": a \"Show fields\" card and a \"Song fields\" card. Use \"New field\" to add one, the pencil to rename, the bin to delete, and drag to reorder. The table counts how many records have a value for each.",
      "Values are filled in on the record. For songs, an admin taps the value under Details on the song page. For shows, it's the admin-only \"Custom fields\" card on Show Details: tap a value, type, and it saves in place when you leave it. A blank value isn't stored.",
      "Deleting a field asks first, and removes its values from every show or song that has one.",
    ].join("\n\n"),
    related: ["songs", "showPage"],
  },
  {
    id: "rehearsals",
    title: "Rehearsals",
    text: [
      "The Rehearsals page lists rehearsals, newest first: Date, Where, Band members (initials), Songs (\"N songs\") and a Recording chip. Click a row to open it. Admins get \"Create Rehearsal\".",
      "Creating one takes: When, Where, Band members, Songs (search and add, with an optional note each), Notes and a Recording. \"Create Rehearsal\" creates it. Where is an autocomplete: its list first offers the places used on earlier rehearsals (\"Doghouse\", say), then address suggestions. A new address asks for a name, and after that it shows in later rehearsals' lists. A new rehearsal goes on the default project (General) until its project is changed.",
      "A rehearsal's page autosaves for admins: a When & where card (date and times, the location with \"Open in Maps\", and the project: tap it to change it, and the rehearsal's money moves to that project), a Songs card (an \"Add a song…\" search, or \"Import from setlist\"; × removes one), Band members with \"Coming\" boxes, Notes (tap the text, or \"Add…\", type, and click away to save), Recordings (\"Attach from Google Drive\") and a Money out card. Money out lists the rehearsal's expenses, bills and payouts (a room rental paid to a person, say); \"+ Money out\" opens the same form, with the project starting on the rehearsal's. Gas to a rehearsal is logged there too: its To is the rehearsal's location.",
      "The › on a song opens that song at this rehearsal: Notes (autosaved; they show under the song on the rehearsal) and Recordings. \"Upload a recording\" puts the file in Drive, in the rehearsal recordings folder chosen on Settings > Google, inside a folder for the rehearsal's date (one already named with the date is reused, otherwise \"{date} Rehearsal\" is made), shares it with the band, and adds it to the song's files too.",
    ].join("\n\n"),
    related: ["songs", "expenses", "setlistTemplates"],
  },
];
