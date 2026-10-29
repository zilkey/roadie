import type { HelpTopic } from "./types";

/** Help text for Albums: the index, an album's three tabs and a track's page. Each sentence is checked against the UI code. */
export const ALBUM_TOPICS: HelpTopic[] = [
  {
    id: "albums",
    title: "Albums",
    text: [
      "Albums sits next to Songs once the band has made its first album (before that the page still opens by link). An album is a record the band is making or has made: a full-length album, an EP or a single.",
      "The Albums page is a table: Album (the cover and title, with the kind under it), Status (Planning, Recording, Mixing, Mastering or Released), Tracks (how many and how long), Release (the target date, or \"Not set\") and, for admins only, Spent and Earned. Members see the same table without the money.",
      "Admins get \"+ Add\", which opens the New album card: title, kind, status, a target release date, a budget, how to start the tracklist (from a setlist template, pick songs after saving, or empty) and whether to make an album folder in the band's Drive folder. \"Create album\" makes the album and its money project together; Cancel throws the draft away.",
    ].join("\n\n"),
    related: ["albumPage", "albumTrack", "albumMoney", "albumFiles", "songs"],
  },
  {
    id: "albumPage",
    title: "An album's page: the Tracks tab",
    text: [
      "An album's page has a header with the cover, the status (admins pick it from the pill), the kind, the title (tap it to rename; the money project is renamed with it), how many tracks and how long, the target release, and how far along the record is: Tracked, Mixed and Mastered out of the total. Admins also see Spent of budget.",
      "Below the header are three tabs: Tracks (the default), Money (admins only) and Files.",
      "Tracks is the running order: # and title (opens the track), Status, Latest mix (its version and whether it was approved or has notes), Files (how many) and Length. Admins drag the grip to reorder, and get \"+ Add tracks\" (pick songs, or a whole setlist template whose order becomes the tracklist; \"Add to\" puts them at the end of the album or of a side) and \"+ Side break\" (vinyl: the tracks from the picked one on become Side B). Each track points at a song; the title and length start from the song and can differ on the album.",
      "Release details sit under the tracklist: Distributor, UPC, Formats (tap to change) and the album's Drive folder (Band folder / Albums / the album's title), made on request.",
      "Archiving an album is in its More menu: its tracks and album-only files go with it and its project is closed, so the money stays readable.",
    ].join("\n\n"),
    related: ["albumTrack", "albumMoney", "albumFiles", "albums", "setlistTemplates"],
  },
  {
    id: "albumMoney",
    title: "An album's Money tab",
    text: [
      "The Money tab is for admins. An album's money is its project's: every expense and income for the record lands on the project made with the album (kind Album, same name), so it also shows under Projects on the Money page.",
      "\"Where it stands\" has Budget (tap to change), Spent (expenses and payouts on the project), Earned (income, received or still owed) and Net so far, with a bar of how much of the budget is spent. Spent by category and Earned by source break those down.",
      "\"All lines\" lists every record on the project, newest first: Date, Category, Track (when it was one track's), Details, Who and Amount, with a filter for Everything, Expenses, Income or Owed back. \"+ Add expense\" opens the expense form on the album's project; \"+ Add income\" opens Money in with the album's project picked and the record kinds (Streaming, Digital sales, CDs and vinyl, Pre-orders, Crowdfunding, Sync) among the choices.",
    ].join("\n\n"),
    related: ["albumPage", "projects", "income", "expenses"],
  },
  {
    id: "albumFiles",
    title: "An album's Files tab",
    text: [
      "Files is for what belongs to the record itself, in four groups: Artwork (cover, back, inserts, labels), Album masters (the full-album masters and the CD image), Liner notes and credits, and Promo (one-sheet, press photos, bio, video). Admins add to each with \"+ Add from Drive\" or an upload into the album's Drive folder.",
      "A file the band can't open is flagged, like a song's charts: \"Share with band\" fixes the sharing, and \"Copy into album folder\" puts a shared copy in Band folder / Albums / the album's title and points the file at it.",
      "Track files (mixes, masters, stems and session files) live on each track: the tab ends with a list of the tracks and how many files each has.",
    ].join("\n\n"),
    related: ["albumTrack", "albumPage", "songs"],
  },
  {
    id: "albumTrack",
    title: "A track's page",
    text: [
      "A track's page is one song's place on the record: \"Track 3 of 10 · Side A\", the title (tap to change it on the album), its length on the album, and the song's key and tempo, with \"Open song\" for the song itself and ‹ › to the tracks either side.",
      "The status steps read Tracking, Overdubs, Mixed and Mastered; admins tap a step to set it. Approving a mix marks the track Mixed and approving a master marks it Mastered.",
      "Mixes are listed newest first by version (v1, v2...), with Approve, a note box (\"Guitar solo a touch quieter\") and the notes left so far. \"+ Add mix from Drive\" and Upload a mix put a new one on the track; the version comes from the file name or is the next number. Master, and Stems and session, work the same way.",
      "Credits is a table of who did what (players start from the band's people; guests are typed); admins add and remove rows. Release details hold the ISRC and whether the track is explicit; Writers and Lyrics come from the song. Costs on this track lists the expenses pinned to the track (admins), and From the song lists the song's own charts and demos.",
    ].join("\n\n"),
    related: ["albumPage", "albumFiles", "songs"],
  },
];
