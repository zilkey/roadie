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
      "A canceled show comes off the Google Calendar and Bandsintown. To cancel one, an admin opens the show and presses the status pill beside the title, which opens \"Change status\". Pick Canceled and press \"Change to Canceled\". Dropped is the other way round: we pulled out.",
    ].join("\n\n"),
    related: ["droppedShows", "upcomingShows", "showPage"],
  },
  {
    id: "droppedShows",
    title: "Shows: Dropped tab",
    text: [
      "The Dropped tab lists shows we pulled out of, newest first. Columns: Date, Venue and Reason. Canceled is the opposite: the venue called it off.",
      "A hold whose date passed without ever being confirmed also lands here, with no reason (a dash).",
      "To drop a show, an admin opens it, presses the status pill beside the title, picks Dropped and presses \"Change to Dropped\", with an optional reason. A dropped show comes off the Google Calendar and Bandsintown.",
    ].join("\n\n"),
    related: ["canceledShows", "upcomingShows", "showPage"],
  },
  {
    id: "showPage",
    title: "A show's page",
    text: [
      "A show's page has three tabs: \"Show Details\", \"Setlist\" and \"Finances\". The title shows the venue and date, with a status pill (Hold, Confirmed, Played, Canceled or Dropped). Admins can press the pill to change status, and use \"Edit\" to open every card on the tab.",
      "Show Details has the cards: \"Where & when\" (venue, map link, times, day-of contact, and \"Add for everyone\" for the calendar), \"Who's playing\" (billed as, players, \"Ask who's free\"), \"Sound\", \"Promotion\" (ticket link, docs, Bandsintown) and, for admins, \"Custom fields\".",
      "In Promotion, admins can \"Publish to Bandsintown\", \"Take off Bandsintown\" or \"Sync Bandsintown now\". Only Confirmed shows get listed.",
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
      "\"+ Song\" lists only songs that are Playing or Learning. \"+ Break\" adds a named break with a length (default \"Talk / tune\", 1:00). Drag, or use the arrows, to reorder; the ✕ removes an item. Members can read it.",
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
      "The Songs page lists every song in four tabs with counts: Playing, Learning, Ideas and Retired. Use \"Search songs…\" to filter by title or writer. Columns: Title, Key, Time and Lyrics. A ♪ means the song has a recording. Admins get \"Add a song\", which searches Drive for audio, video and docs as you type the title.",
      "A song's page shows its status, key, BPM and length, plus Details (written by, last rehearsed, notes and any custom fields). Admins press \"Edit\" to change them; it saves as they type, and \"Done\" closes it. \"More\" has \"Archive song\".",
      "\"Charts & recordings\" lists the song's files and links, grouped as Charts, Demos, Recordings, Rehearsal takes, Lyrics, Stems and Other. Audio and video have a Play button. Admins use \"+ Add from Drive\", and \"Run sharing check\" to flag files the band can't open or that sit outside the band folder.",
    ].join("\n\n"),
    related: ["setlists", "customFields", "rehearsals"],
  },
  {
    id: "income",
    title: "Income on a show",
    text: [
      "Income is admin-only. It's the \"Income\" card on a show's Finances tab, and it's a list of lines for how the show pays. A new show asks \"What's the deal?\" with starters: \"Guarantee\", \"Door split\" or \"Tips only\". Add tips and merch after the show.",
      "Press \"Edit\" on the card. Each line has What (Guarantee, Door split, Tips, Merch or Other), Amount, How paid (Cash, Venmo, Check, Square, Card, Bank or Other) and a Rec'd box for money actually received. \"+ Add income\" adds a line. There's a Total and a Notes box.",
      "Below it, \"Net for the show\" is income minus the show's expenses.",
      "These totals feed the Played tab (Total income) and the Money page (In, By show, By category). Every line counts, received or not.",
    ].join("\n\n"),
    related: ["expenses", "money", "playedShows", "showPage"],
  },
  {
    id: "expenses",
    title: "Expenses",
    text: [
      "An expense is something a band member paid for. Add them on a show's Finances tab (\"Expenses\" card), on a rehearsal's page, or from the Money page with \"Add an expense\".",
      "On the cards, press \"Edit\", then \"+ Add expense\". Each line has What, Amount, Pay back (the default) and \"Attach receipt\" (paste a Google Drive link). Admins also choose Paid by, and can \"Mark paid back\". An unpaid pay-back line shows \"Owed\". Paid-back lines are locked. Members only see and add their own.",
      "\"Add an expense\" has category chips: Gas, Room rental, Gear, Food and Other. Pick a show if it's for one. Gas works out an estimate from distance, MPG and gas price, which you can overwrite. Admins can log it \"For\" a bandmate. It's saved with the Save button.",
    ].join("\n\n"),
    related: ["money", "income", "rehearsals", "showPage"],
  },
  {
    id: "money",
    title: "Money",
    text: [
      "For admins, the Money page has three tabs. Overview shows In (all show income), Out (all expenses) and Left, with a month chart. \"Owed to people\" lists unpaid pay-back expenses per person, each with \"Mark paid back\". \"By show\" charts each show's take, and \"By category\" breaks it down by Guarantee, Door split, Gear and so on.",
      "\"Add an expense\" is at the top right.",
      "For members, the page is \"My money\": their own expenses with a status (Owed, Paid back on a date, or Not paid back), and \"Add an expense\". They can edit or remove an expense until it's been paid back.",
      "Income comes from each show's Finances tab.",
    ].join("\n\n"),
    related: ["income", "expenses", "playedShows"],
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
      "Values are filled in on the record. For songs, an admin presses \"Edit\" on the song page. For shows, it's the admin-only \"Custom fields\" card on Show Details. A blank value isn't stored.",
      "Deleting a field asks first, and removes its values from every show or song that has one.",
    ].join("\n\n"),
    related: ["songs", "showPage"],
  },
  {
    id: "rehearsals",
    title: "Rehearsals",
    text: [
      "The Rehearsals page lists past rehearsals, newest first: Date, Where, Who was there (initials), Songs (\"N songs run\") and a Recording chip. Click a row to open it. Admins get \"Log a rehearsal\".",
      "Logging one takes: When, Where, Who was there, \"We ran\" (tick songs, with an optional note each), Notes and a Recording. \"Save rehearsal\" creates it. What you tick is what the song page's \"Last rehearsed\" uses.",
      "A rehearsal's page autosaves for admins: date and times, a Location card (with \"Open in Maps\"), a Songs card (\"+ Song\" or \"Import from setlist\"), Band members with \"Coming\" boxes, Recordings (\"Attach from Google Drive\") and an Expenses card. \"+ Add an expense\" is where gas to rehearsal gets logged.",
    ].join("\n\n"),
    related: ["songs", "expenses", "setlistTemplates"],
  },
];
