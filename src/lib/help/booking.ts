import type { HelpTopic } from "./types";

/** Help for the Booking pages. Every sentence is checked against the Booking UI and booking commands. */
export const BOOKING_TOPICS: HelpTopic[] = [
  {
    id: "booking",
    title: "Booking: finding a place to pitch",
    text:
      "Booking is home base for every place you might play, and it opens on the \"Pitch List\" tab. The tabs are \"Pitch List\", \"Venues\", \"Festivals & series\" (a festival or series with each year under it), \"Promoters\" and \"Contacts\". The number on \"Pitch List\" counts your active pitches. Use the other tabs to find a place to pitch.\n\n" +
      "Type in the search box (\"Search places, festivals, contacts…\") and the list narrows. The search stays when you switch tabs. On the Venues tab, venues go first, with the ones your band has notes, a pitch or a show on at the top, then the rest of the shared directory by name.\n\n" +
      "The little flag on a row means the place is on your Pitch List. A filled flag is an active pitch, and clicking it opens that pitch. On the Venues, \"Festivals & series\" and Promoters tabs a place with an active pitch opens the pitch when you click its name, and a small \"Venue page\", \"Festival page\" or \"Promoter page\" link under the name opens the place itself. An empty flag adds it: a window asks for the lineup, possible dates and an optional first comment, then \"Add to Pitch List\". Flags are on venues, festival years and promoters, not contacts.\n\n" +
      "\"+ Add\" at the top adds a place, a festival or series, a promoter or a contact. A venue's type comes from one list every band shares: pick \"Other…\" to add a new one (Artist settings → Venue types renames or removes them).\n\n" +
      "The \"Festivals & series\" tab shows each year's dates and application deadline. Tap the Dates or Deadline header to sort by it (again to flip it); years without one go last. It shows 80 rows at a time, then \"Load more\".",
    related: ["pitch", "venueSharing", "pitchStatuses"],
  },
  {
    id: "pitch",
    title: "Pitches and the Pitch List",
    text:
      "A pitch is a venue, promoter or festival year you want to play, tracked on the Pitch List. Flag a place on any Booking tab to start one. It begins as \"To Pitch\". The \"Pitch List\" is the first tab of Booking, and clicking a name on it opens the pitch. It shows active pitches with their type, city, configuration and dates, the date of last contact, and the next step (with \"by\" its date), and has \"Filter by\" menus: one status, a category (venues, festivals or promoters), a city or state, and a venue type (hidden when you pick festivals).\n\n" +
      "Open a pitch to work it. \"Status\" has \"Where it's at\" and a \"Next step\" (words plus a date). \"Email\" fills one of your templates and sends from your own Gmail. \"Check for replies\" pulls answers into the timeline. \"Lineup\" sets the configuration, who's on it and who's handling it. \"Dates & shows\" holds the possible dates.\n\n" +
      "\"Activity\" is the timeline. Post a \"Comment\" for the band talking it over, or log a \"Call\". Calls, emails and sends count as contact. Comments don't.\n\n" +
      "\"Booked it\" is a button in the page header. It opens a form under the header: pick the date, the final configuration, whether to send calendar invitations and whether to copy the comments. The pitch moves to Booked once the show is created. \"Abandon pitch\" at the bottom of the page moves it to Dropped.\n\n" +
      "A pitch needs a nudge when its next step is due or overdue, or when it is Pitched or Talking with no contact for 14 days. Those rows turn yellow on the Pitch List.",
    related: ["pitchStatuses", "booking", "upcomingShows", "showPage"],
  },
  {
    id: "pitchStatuses",
    title: "Pitch statuses",
    text:
      "Every pitch is in one of seven statuses:\n" +
      "- \"Future Pitch\": a place you're thinking about.\n" +
      "- \"To Pitch\": on the list, nothing sent yet.\n" +
      "- \"Pitched\": you sent it and are waiting to hear back.\n" +
      "- \"Talking\": in conversation.\n" +
      "- \"Booked\": you got the gig.\n" +
      "- \"Declined\": they said no.\n" +
      "- \"Dropped\": you stopped.\n\n" +
      "Active ones are Future Pitch, To Pitch, Pitched and Talking. They show a filled flag and count on the \"Pitch List\" tab. Booked, Declined and Dropped are past. Declined means they said no, and Dropped means you walked away.\n\n" +
      "Moving a pitch to Pitched or Talking counts as contact today, so the quiet clock restarts. Other moves don't. Each move is logged on the pitch's \"Activity\" timeline.",
    related: ["pitch", "booking"],
  },
  {
    id: "venueSharing",
    title: "Venue pages: shared and private",
    text:
      "A venue page has two groups. \"Shared with every band on Roadie\" is the \"About the room\" card: name, address, type, capacity and website. There is one shared venue directory, so other bands using the app see these details, and an edit changes them for all of them. Your name goes in the history. The card warns: \"Every band on Roadie sees these details.\"\n\n" +
      "The pitch is a small card at the very top, above both groups. It says \"On the Pitch List\" with the status, configuration, dates, last contact and next step, and \"View pitch\" opens the pitch page. Or it says \"Not on the Pitch List\" with \"Add to Pitch List\". A line underneath lists earlier pitches (\"Pitched before\"). All the work on a pitch happens on the pitch page.\n\n\"Only <your band> sees this\" holds your contacts, \"Our notes\" (booked by, load-in, notes) and \"Our shows here\". Other bands never see those.\n\n" +
      "On the \"Contacts\" card, tick \"Booking\" for whoever you pitch and book with and \"Day-of\" for whoever to call on the day of a show. One person can have both, and several people can share one. Pitch emails go to the booking contacts first. A new show here gets the first day-of contact.\n\n" +
      "\"Archive venue\" (in \"More\") hides it from your lists only. Other bands keep it. You can bring it back later.\n\n" +
      "\"Merge into another venue…\" fixes duplicates, and it affects every band. Their shows, pitches and notes move to the venue you keep. The other one is archived, and you can undo it from History.\n\n" +
      "Adding a new venue says: \"Other bands will see this venue's name, address and details.\"",
    related: ["booking", "pitch"],
  },
];
