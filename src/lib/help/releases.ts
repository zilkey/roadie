import type { HelpTopic } from "./types";

/** Help text for Releases: the index, a release's three tabs and a track's page. Each sentence is checked against the UI code. */
export const RELEASE_TOPICS: HelpTopic[] = [
  {
    id: "releases",
    title: "Releases",
    text: [
      "Releases sits next to Songs in the menu (it starts in More; the Edit menu dialog moves it up). A release is a record the band is making or has made: a full-length album, an EP or a single.",
      "The Releases page is a table: Release (the cover and title, with the kind under it), Progress (Tracked, Mixed and Mastered out of the tracks, or Released once the release date has passed), Tracks (how many and how long), Release (the target date, or \"Not set\"), Spent and Earned.",
      "Admins get \"+ Add\", which opens the New release card: title, kind, a target release date and the release folder (search the band's Drive by name or paste a folder link; it can be anywhere in Drive, and can be left for later). \"Create release\" makes the release and its money project together, with no tracks yet: the tracklist is built on the release page. Cancel throws the draft away.",
    ].join("\n\n"),
    related: ["releasePage", "releaseTrack", "releaseMoney", "releaseFiles", "songs"],
  },
  {
    id: "releasePage",
    title: "A release's page: the Tracks tab",
    text: [
      "A release's page has the title (tap it to rename; the money project is renamed with it) and, right under it, three tabs: Tracks (the default), Money and Files.",
      "Tracks starts with a card: the cover, the kind, how many tracks and how long, the target release, and how far along the record is: Tracked, Mixed and Mastered out of the total (a release has no status of its own: each track has one). Admins also see Spent.",
      "Under the card is the running order: # and title (opens the track), Status, Latest mix (its version and whether it was approved or has notes), Files (how many) and Length. Admins drag the grip to reorder, and get \"+ Add tracks\" (pick songs, or a whole setlist template whose order becomes the tracklist; \"Add to\" puts them at the end of the release or of a side) and \"+ Side break\" (vinyl: the tracks from the picked one on become Side B). Each track points at a song; the title and length start from the song and can differ on the release.",
      "Release details sit under the tracklist: Distributor, UPC, Formats (tap to change) and the release's Drive folder. Without one, admins press \"Connect Drive folder\": search the band's Drive by name or paste a folder link to use an existing folder, or type a name (it starts as the release's title) and Create to make a new folder inside the Releases folder chosen on Settings > Google (Create is off, with a link to Settings, until that folder is chosen). \"Change\" on a connected folder does the same.",
      "Archiving a release is in its More menu: its tracks and release-only files go with it and its project is closed, so the money stays readable.",
    ].join("\n\n"),
    related: ["releaseTrack", "releaseMoney", "releaseFiles", "releases", "setlistTemplates"],
  },
  {
    id: "releaseMoney",
    title: "A release's Money tab",
    text: [
      "A release's money is its project's: every expense and income for the record lands on the project made with the release (kind Release, same name), so it also shows under Projects on the Money page.",
      "\"Where it stands\" has Spent (expenses and payouts on the project), Earned (income, received or still owed) and Net so far. Spent by category and Earned by source break those down.",
      "\"All lines\" lists every record on the project, newest first: Date, Category, Track (when it was one track's), Details, Who and Amount, with a filter for Everything, Expenses, Income or Owed back. \"+ Money in\" and \"+ Money out\" are the same forms as on the Money page, opened with the release's project picked (Money in offers the record kinds: Streaming, Digital sales, CDs and vinyl, Pre-orders, Crowdfunding, Sync). Both get a Track field when the project is a release's: pick one of its tracks to pin the money to it (\"Whole release\" otherwise), and it shows in the Track column.",
    ].join("\n\n"),
    related: ["releasePage", "projects", "income", "expenses"],
  },
  {
    id: "releaseFiles",
    title: "A release's Files tab",
    text: [
      "Files is for what belongs to the record itself, in four groups: Artwork (cover, back, inserts, labels), Release masters (the full-release masters and the CD image), Liner notes and credits, and Promo (one-sheet, press photos, bio, video). Admins add to each with \"+ Add from Drive\" or an upload into the release's Drive folder.",
      "A file the band can't open is flagged, like a song's charts: \"Share with band\" fixes the sharing, and \"Copy into release folder\" puts a shared copy in the release's Drive folder and points the file at it.",
      "Track files (mixes, masters, stems and session files) live on each track: the tab ends with a list of the tracks and how many files each has.",
    ].join("\n\n"),
    related: ["releaseTrack", "releasePage", "songs"],
  },
  {
    id: "releaseTrack",
    title: "A track's page",
    text: [
      "A track's page is one song's place on the record: \"Track 3 of 10 · Side A\", the title (tap to change it on the release), its length on the release, and the song's key and tempo, with \"Open song\" for the song itself and ‹ › to the tracks either side.",
      "The status steps read Tracking, Overdubs, Mixed and Mastered; admins tap a step to set it. Approving a mix marks the track Mixed and approving a master marks it Mastered.",
      "Mixes are listed newest first by version (v1, v2...), with Approve, a note box (\"Guitar solo a touch quieter\") and the notes left so far. \"+ Add mix from Drive\" and Upload a mix put a new one on the track; the version comes from the file name or is the next number. Master, and Stems and session, work the same way.",
      "Credits is a table of who did what (players start from the band's people; guests are typed); admins add and remove rows. Release details hold the ISRC and whether the track is explicit; Writers and Lyrics come from the song. Costs on this track lists the expenses pinned to the track (admins), and From the song lists the song's own charts and demos.",
    ].join("\n\n"),
    related: ["releasePage", "releaseFiles", "songs"],
  },
];
