import type { HelpTopic } from "./types";

/** Help for the Booking pages. Every sentence is checked against the Booking UI and booking commands. */
export const BOOKING_TOPICS: HelpTopic[] = [
  {
    id: "booking",
    title: "Booking: the All tab",
    text:
      "Booking is home base for every place you might play. The \"All\" tab lists venues, festival years (a festival or series with each year under it) and promoters in one table. Contacts only show up here when you search. The other tabs are \"Pitch List\", \"Venues\", \"Festivals & series\", \"Promoters\" and \"Contacts\". The number on \"Pitch List\" counts your active pitches.\n\n" +
      "Type in the search box (\"Search places, festivals, contacts…\") and the list narrows. The search stays when you switch tabs. Venues go first, with the ones your band has notes, a pitch or a show on at the top, then the rest of the shared directory by name.\n\n" +
      "The little flag on a row means the place is on your Pitch List. A filled flag is an active pitch, and clicking it opens that pitch. An empty flag adds it: a window asks for the lineup, possible dates and an optional first comment, then \"Add to Pitch List\". Flags are on venues, festival years and promoters, not contacts.\n\n" +
      "\"+ Add\" at the top adds a place, a festival or series, a promoter or a contact.",
    related: ["pitch", "venueSharing", "pitchStatuses"],
  },
  {
    id: "pitch",
    title: "Pitches and the Pitch List",
    text:
      "A pitch is a venue, promoter or festival year you want to play, tracked on the Pitch List. Flag a place on any Booking tab to start one. It begins as \"To pitch\". The \"Pitch List\" tab shows active pitches and has a \"Filter by\" menu for one status.\n\n" +
      "Open a pitch to work it. \"Status\" has \"Where it's at\" and a \"Next step\" (words plus a date). \"Email\" fills one of your templates and sends from your own Gmail. \"Check for replies\" pulls answers into the timeline. \"Lineup\" sets the configuration, who's on it and who's handling it. \"Dates & shows\" holds the possible dates.\n\n" +
      "\"Activity\" is the timeline. Post a \"Comment\" for the band talking it over, or log a \"Call\". Calls, emails and sends count as contact. Comments don't.\n\n" +
      "\"Booked it\" starts a new show from the pitch, and the pitch moves to Booked once that show is created.\n\n" +
      "A pitch needs a nudge when its next step is due or overdue, or when it is Pitched or Waiting with no contact for 10 days.",
    related: ["pitchStatuses", "booking", "upcomingShows", "showPage"],
  },
  {
    id: "pitchStatuses",
    title: "Pitch statuses",
    text:
      "Every pitch is in one of eight statuses:\n" +
      "- \"Idea\": a place you're thinking about.\n" +
      "- \"To pitch\": on the list, nothing sent yet.\n" +
      "- \"Pitched\": you sent it.\n" +
      "- \"Waiting\": waiting to hear back.\n" +
      "- \"Talking\": in conversation.\n" +
      "- \"Booked\": you got the gig.\n" +
      "- \"Declined\": they said no.\n" +
      "- \"Dropped\": you stopped.\n\n" +
      "Active ones are Idea, To pitch, Pitched, Waiting and Talking. They show a filled flag and count on the \"Pitch List\" tab. Booked, Declined and Dropped are past. Declined means they said no, and Dropped means you walked away.\n\n" +
      "Moving a pitch to Pitched, Waiting or Talking counts as contact today, so the quiet clock restarts. Other moves don't. Each move is logged on the pitch's \"Activity\" timeline.",
    related: ["pitch", "booking"],
  },
  {
    id: "venueSharing",
    title: "Venue pages: shared and private",
    text:
      "A venue page has two groups. \"Shared with every band on Roadie\" is the \"About the room\" card: name, address, type, capacity and website. There is one shared venue directory, so other bands using the app see these details, and an edit changes them for all of them. Your name goes in the history. The card warns: \"Every band on Roadie sees these details.\"\n\n" +
      "\"Only <your band> sees this\" holds your own pitch, contacts, \"Our notes\" (booked by, load-in, notes) and \"Our shows here\". Other bands never see those.\n\n" +
      "\"Archive venue\" (in \"More\") hides it from your lists only. Other bands keep it. You can bring it back later.\n\n" +
      "\"Merge into another venue…\" fixes duplicates, and it affects every band. Their shows, pitches and notes move to the venue you keep. The other one is archived, and you can undo it from History.\n\n" +
      "Adding a new venue says: \"Other bands will see this venue's name, address and details.\"",
    related: ["booking", "pitch"],
  },
];
