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
      "A show's page has three tabs: \"Show Details\", \"Setlist\" and \"Finances\". The title shows the venue and date, with a status pill (Hold, Confirmed, Played, Canceled or Dropped). Admins can press the pill to change status. There is no page-wide Edit: tap a value on a card to change it, and it saves when you leave it.",
      "Show Details has the cards: \"Where & when\" (venue, map link, times, day-of contact, and \"Add to calendar…\", which previews the event and its invites before sending it to the band calendar; saving a show never changes the calendar. Admins press the pencil to change the venue, date or kind of show: it saves as you go and Done closes it. Tap a time or the set length to change it; it saves when you leave it. A new show starts with the venue's day-of contact; tap the day-of contact to pick someone from the venue, \"Someone else…\" (added to the venue's contacts as a day-of contact) or None), \"Who's playing\" (billed as, players, \"Ask who's free\"), \"Sound\", \"Promotion\" (ticket link, docs, Bandsintown) and, for admins, \"Custom fields\".",
      "In Who's playing, admins tap a person to put them on the show or take them off; it saves at once. Picking a lineup under \"Billed as\" fills in its players. \"Ask who's free\" sits in the card's header, and the answers show under the players.",
      "In Promotion, admins tap the ticket link to change it (it saves when you leave it), add a doc with the plus beside Docs and take one off with its ×. Admins can also \"Publish to Bandsintown\", \"Take off Bandsintown\" or \"Sync Bandsintown now\". Only Confirmed shows get listed.",
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
      "A show's Finances tab has four cards. \"Project\" (admins) says which project the show's money belongs to: a new show takes its configuration's project (Full band goes to Band, Duo to Duo) and an admin can change it. \"Money in\", \"Paid out\" and \"Expenses\" list every record on the show, and \"This show\" on the side adds them up: In, Paid out, Expenses, Net to the project, Still owed to us, We still owe.",
      "Income is admin-only. \"+ Money in\" opens a small form: \"Owed to us\" or \"We got it\", what for (Guarantee, Door, Tips, Merch, Streaming, Sync, Grant, Gear sale or Other), who from, the amount, the project and show, and when it's received, how (Cash, Venmo, Check, Square, Card, Bank or Other) and when. A line marked \"Owed to us\" has a \"Received\" button. Income doesn't need a show: Bandcamp sales or a grant go on the Money page.",
      "\"Paid out\" is money from the band to a person: a player's pay for the show, another band's cut, or something else. \"+ Money out\" asks \"We owe\" or \"We paid\", the kind (a bill or purchase, pay for playing, another band's cut, other), To (type a name: band people, players, contacts, or keep what you typed), the amount, what for, the project and show, and for \"We paid\" who paid (an admin, from their own account: the band has no account), when, and for a payout how. An unpaid payout shows \"We owe\" with a \"Mark paid\" button. \"Split evenly\" proposes one unpaid payout per player on the show from what's left after expenses; edit the amounts and press \"Add payouts\".",
      "Every record counts, received or paid or not. The totals feed the Played tab and the Money page.",
    ].join("\n\n"),
    related: ["expenses", "payouts", "money", "projects", "playedShows", "showPage"],
  },
  {
    id: "payouts",
    title: "Payouts and what we owe",
    text: [
      "A payout is money the band pays a person: \"Pay for playing\", \"Another band's cut\", \"Paid back\" (an expense reimbursed) or \"Other\". It goes to a band member, a player, a contact or just a name. Until it's marked paid it counts as \"We owe\"; once paid it records how (Cash, Venmo, Check...), when, and which admin paid it from their own account. A \"Paid back\" payout is never listed on its own: the expense it paid back says who paid whom back and when.",
      "Admins add them with \"+ Money out\" on a show's Finances tab, the Money page or a project page. In the form, \"Pay back something they bought\" isn't a payout at all: it saves an expense in that person's name with pay back on, the same record they'd make themselves (\"we owe Eric $42 for gas\").",
      "On the Money page, \"We owe\" groups unpaid payouts, unpaid bills and unpaid pay-back expenses by person. Pay-back expenses get a \"Pay\" button that opens Money out on \"We paid\" with their items ticked; a bill or a payout gets \"Mark paid\", which asks who paid and when. Paying someone back marks their expenses paid back and writes one \"Paid back\" payout listing them.",
      "Members see only the payouts made to them, as \"Paid to me\" on My money, and only once they're paid.",
    ].join("\n\n"),
    related: ["income", "expenses", "money", "projects"],
  },
  {
    id: "projects",
    title: "Projects",
    text: [
      "A project is a bucket money belongs to: Band (the default), Duo, a release, a tour, a music video, or anything else. Every income, expense and payout is on exactly one project; a record with none counts as Band. A show has a project too, set from its configuration, and its money lands there.",
      "Admins see the Projects tab on the Money page: a table of Project, Kind, When, In, Out and Net, with closed projects folded away. \"New project\" asks for a name, kind and dates, and saves with \"Add\". A project page shows Spent, In so far, Net (owed amounts included), We owe, Money in and Money out tabs and spent by category; a show that hasn't happened yet stays out of Money in and the tiles until its date; its name and dates edit in place, and each record's name, amount and project edit in place (a record that belongs to a show links to the show instead of editing its name here), and \"Close project\" keeps it readable but takes nothing new. A project is never deleted.",
      "Members see the list too, just names, kinds and dates, so they can pick a project when they add an expense.",
      "A release has a project of its own, made with it: the release's Money tab is that project's money, measured against the release's budget. Tours aren't attached to projects yet.",
    ].join("\n\n"),
    related: ["money", "income", "expenses", "payouts"],
  },
  {
    id: "expenses",
    title: "Expenses",
    text: [
      "An expense is something bought or a bill: who was paid (the vendor, \"To\") and who paid it from their own account. Add them on a show's Finances tab (\"Expenses\" card), on a rehearsal's page, from the Money page with \"Add an expense\", or with \"+ Money out\" and \"A bill or purchase\", where \"We owe\" logs a bill nobody has paid yet and \"We paid\" asks who paid and when. A bill shows \"We owe\" until \"Mark paid\" names the payer and the date.",
      "\"Add an expense\" has an Amount, category chips (Travel, Food, Gear, Lodging, Recording, Mixing, Mastering, Pressing, Artwork, Photo, Video, Room rental, Marketing, Fees or Other), What for, a Project (open projects; it picks the show's project, else Band), an optional show, \"The band should pay me back\" (on by default) and \"Attach receipt\" (a Google Drive link). Travel works out a gas estimate from distance, MPG and gas price, which you can overwrite. Admins can log it \"For\" a bandmate. It's saved with the Save button.",
      "A pay-back expense shows \"waiting\" until an admin pays it back (\"Pay\" on the Money page, or Money out with \"We paid\" and \"Pay back something they bought\"); then it shows \"paid back\" with the date and is locked. One with pay back off shows \"no pay back\": the band's own money paid it. Members only see and add their own; they can change an expense's project until it's paid back.",
    ].join("\n\n"),
    related: ["money", "income", "payouts", "projects", "rehearsals", "showPage"],
  },
  {
    id: "money",
    title: "Money",
    text: [
      "For admins, the Money page has tabs Overview, Projects, By show and By category, with \"+ Money in\", \"+ Money out\" and \"Add an expense\" at the top. Overview shows In (income received), Out (expenses and payouts actually paid) and Net, then Owed to us, We owe and \"Net once everything settles\", with a month chart of money that moved; \"Expected\" (guarantees booked for shows not played yet, counted nowhere else until the date passes); \"Owed to us\" (income not yet received, each with \"Received\"); \"We owe\" grouped by person (unpaid payouts, bills and pay-back expenses, with \"Pay\" or \"Mark paid\"); \"Recently\"; and \"Open projects\" with each project's net. A project page adds \"Who paid\" beside \"Spent by category\".",
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
      "Creating one takes: When, Where, Band members, Songs (search and add, with an optional note each), Notes and a Recording. \"Create Rehearsal\" creates it. The songs on a rehearsal are what the song page's \"Last rehearsed\" uses.",
      "A rehearsal's page autosaves for admins: date and times, a Location card (with \"Open in Maps\"), a Songs card (an \"Add a song…\" search, or \"Import from setlist\"; × removes one), Band members with \"Coming\" boxes, Notes (tap the text, or \"Add…\", type, and click away to save), Recordings (\"Attach from Google Drive\") and an Expenses card. \"+ Add an expense\" is where gas to rehearsal gets logged.",
      "The › on a song opens that song at this rehearsal: Notes (autosaved; they show under the song on the rehearsal) and Recordings. \"Upload a recording\" puts the file in Drive, in the rehearsal recordings folder chosen on Settings > Google, inside a folder for the rehearsal's date (one already named with the date is reused, otherwise \"{date} Rehearsal\" is made), shares it with the band, and adds it to the song's files too.",
    ].join("\n\n"),
    related: ["songs", "expenses", "setlistTemplates"],
  },
];
